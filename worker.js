import { workerData, parentPort } from 'worker_threads';
import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { Api } from 'telegram/tl/api.js';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import mime from 'mime-types';
import config from './config.js'; // Import configuration

// Extract worker data
const { link, stringSession, apiId, apiHash, downloadsPath } = workerData;

// Initialize Telegram client
const client = new TelegramClient(new StringSession(stringSession), apiId, apiHash, {
    connectionRetries: config.CONNECTION_RETRIES,
    timeout: config.CLIENT_TIMEOUT,
    useWSS: true,
});

// Download control variables
let isPaused = false;
let isCancelled = false;

// Handle messages from the main thread
parentPort.on('message', (message) => {
    switch (message.action) {
        case 'pause':
            isPaused = true;
            logger.info('Download paused');
            break;
        case 'resume':
            isPaused = false;
            logger.info('Download resumed');
            break;
        case 'cancel':
            isCancelled = true;
            logger.info('Download cancelled');
            break;
        default:
            logger.warn(`Unknown action received: ${message.action}`);
    }
});

/**
 * Get file extension based on MIME type
 * @param {string} mimeType - MIME type of the file
 * @param {string} defaultExt - Default extension if MIME type is not recognized
 * @returns {string} File extension
 */
function getFileExtension(mimeType, defaultExt = 'bin') {
    return mime.extension(mimeType) || defaultExt;
}

/**
 * Get file information from a Telegram message
 * @param {Object} message - Telegram message object
 * @returns {Object|null} File information or null if no downloadable media
 */
async function getFileInfo(message) {
    if (message.media) {
        if (message.media instanceof Api.MessageMediaDocument) {
            const document = message.media.document;
            let fileName = 'unknown';
            let fileExtension = 'bin';
            
            const fileNameAttr = document.attributes.find(attr => attr instanceof Api.DocumentAttributeFilename);
            if (fileNameAttr) {
                fileName = fileNameAttr.fileName;
                fileExtension = path.extname(fileName).slice(1) || getFileExtension(document.mimeType, 'bin');
            } else {
                fileExtension = getFileExtension(document.mimeType, 'bin');
                fileName = `file.${fileExtension}`;
            }

            return {
                size: document.size,
                name: fileName,
                mimeType: document.mimeType,
                extension: fileExtension
            };
        } else if (message.media instanceof Api.MessageMediaPhoto) {
            const sizes = message.media.photo.sizes;
            const largestSize = sizes[sizes.length - 1];
            return {
                size: largestSize.size || 0,
                name: `photo_${message.media.photo.id}.jpg`,
                mimeType: 'image/jpeg',
                extension: 'jpg'
            };
        }
    }
    return null;
}

/**
 * Download media from a Telegram message
 * @param {Object} message - Telegram message object
 * @returns {Promise<Object>} Download result
 */
async function downloadMedia(message) {
    const fileInfo = await getFileInfo(message);
    if (!fileInfo) {
        logger.warn('The message does not contain downloadable media.');
        return { error: 'The message does not contain downloadable media.' };
    }

    logger.info(`Preparing to download: ${fileInfo.name} (${fileInfo.mimeType}), size: ${fileInfo.size} bytes`);

    const fileName = path.join(downloadsPath, `downloaded_${fileInfo.name}`);
    const totalSize = fileInfo.size;
    let downloadedSize = 0;
    let startTime = Date.now();
    let lastUpdateTime = 0;

    const file = fs.createWriteStream(fileName);

    return new Promise((resolve, reject) => {
        client.downloadMedia(message.media, {
            outputFile: file,
            progressCallback: (downloaded) => {
                // Handle pause and cancel
                while (isPaused && !isCancelled) {
                    return new Promise(resolve => setTimeout(resolve, 100));
                }
                if (isCancelled) {
                    file.close();
                    fs.unlink(fileName, () => {});
                    reject(new Error('Download cancelled'));
                    return;
                }
                
                downloadedSize = downloaded;
                const currentTime = Date.now();
                const elapsedTime = (currentTime - startTime) / 1000;
                const speed = (downloaded / elapsedTime / (1024 * 1024)).toFixed(2);
                const progress = totalSize ? Math.round((downloaded / totalSize) * 100) : 0;
                
                if (currentTime - lastUpdateTime >= config.PROGRESS_UPDATE_INTERVAL) {
                    const downloadedMB = (downloadedSize / (1024 * 1024)).toFixed(2);
                    const totalMB = (totalSize / (1024 * 1024)).toFixed(2);
                    parentPort.postMessage({ 
                        type: 'progress', 
                        fileName: fileInfo.name,
                        progress, 
                        speed,
                        downloadedSize: downloadedMB,
                        totalSize: totalMB
                    });
                    lastUpdateTime = currentTime;
                }
            }
        }).then(() => {
            file.end(() => {
                const finalElapsedTime = (Date.now() - startTime) / 1000;
                const finalSpeed = (totalSize / finalElapsedTime / (1024 * 1024)).toFixed(2);
                logger.info(`Download completed: ${fileName} - Total size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB, Average speed: ${finalSpeed} MB/s`);
                parentPort.postMessage({ 
                    type: 'complete', 
                    fileName: fileInfo.name, 
                    totalSize: (totalSize / (1024 * 1024)).toFixed(2), 
                    finalSpeed 
                });
                resolve({ fileName: fileInfo.name, totalSize, finalSpeed });
            });
        }).catch((error) => {
            logger.error(`Error during download of ${fileName}:`, error);
            file.close(() => {
                fs.unlink(fileName, (err) => {
                    if (err) logger.error(`Error deleting incomplete file: ${err}`);
                    parentPort.postMessage({ type: 'error', message: error.message });
                    reject(error);
                });
            });
        });
    });
}

/**
 * Process a Telegram link
 * @param {string} link - Telegram message link
 */
async function processLink(link) {
    try {
        await client.connect();
        logger.info(`Processing link: ${link}`);
        let channelId, messageId;

        if (link.includes('t.me/c/')) {
            // Private channel
            const parts = link.split('/');
            channelId = parseInt('-100' + parts[4]);
            messageId = parseInt(parts[parts.length - 1]);
        } else if (link.match(/t\.me\/[a-zA-Z0-9_]+\/\d+/)) {
            // Public channel
            const parts = link.split('/');
            const channelName = parts[3];
            messageId = parseInt(parts[4]);
            
            // Resolve the channel username to get the channel ID
            const resolveResult = await client.invoke(new Api.contacts.ResolveUsername({
                username: channelName
            }));
            channelId = resolveResult.chats[0].id;
        } else {
            throw new Error('Unsupported link format');
        }

        const result = await client.invoke(new Api.channels.GetMessages({
            channel: channelId,
            id: [new Api.InputMessageID({ id: messageId })]
        }));

        if (result.messages && result.messages.length > 0) {
            const downloadResult = await downloadMedia(result.messages[0]);
            parentPort.postMessage({ type: 'complete', ...downloadResult });
        } else {
            logger.warn('Message not found.');
            parentPort.postMessage({ type: 'error', message: 'Message not found.' });
        }
    } catch (error) {
        logger.error('Error processing link:', error);
        parentPort.postMessage({ type: 'error', message: `Error processing link: ${error.message}` });
    } finally {
        await client.disconnect();
        logger.info('Client disconnected');
    }
}

// Main execution
processLink(link).catch(error => logger.error('Uncaught error in processLink:', error));