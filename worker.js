import { workerData, parentPort } from 'worker_threads';
import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { Api } from 'telegram/tl/api.js';
import fs from 'fs';
import logger from './logger.js';

const { link, stringSession, apiId, apiHash } = workerData;

const client = new TelegramClient(new StringSession(stringSession), apiId, apiHash, {
    connectionRetries: 5,
    timeout: 60000, // 60 seconds
});

let isPaused = false;

// Listen for pause/resume messages from the parent thread
parentPort.on('message', (message) => {
    if (message.action === 'pause') {
        isPaused = true;
        logger.info('Download paused');
    } else if (message.action === 'resume') {
        isPaused = false;
        logger.info('Download resumed');
    }
});

// Function to extract file information from a Telegram message
async function getFileInfo(message) {
    if (message.media) {
        if (message.media instanceof Api.MessageMediaDocument) {
            return {
                size: message.media.document.size,
                name: message.media.document.attributes.find(attr => attr instanceof Api.DocumentAttributeFilename)?.fileName || 'unknown'
            };
        } else if (message.media instanceof Api.MessageMediaPhoto) {
            // For photos, exact size isn't available before download
            // We can estimate based on the highest available resolution
            const sizes = message.media.photo.sizes;
            const largestSize = sizes[sizes.length - 1];
            return {
                size: largestSize.size || 0,
                name: `photo_${message.media.photo.id}.jpg`
            };
        }
    }
    return null;
}

// Function to download media from a Telegram message
async function downloadMedia(message) {
    const fileInfo = await getFileInfo(message);
    if (!fileInfo) {
        logger.warn('The message does not contain downloadable media.');
        return { error: 'The message does not contain downloadable media.' };
    }

    const fileName = `downloaded_${fileInfo.name}`;
    const totalSize = fileInfo.size;
    let downloadedSize = 0;
    let startTime = Date.now();
    let lastUpdateTime = 0;

    const file = fs.createWriteStream(fileName);

    try {
        await client.downloadMedia(message.media, {
            outputFile: file,
            progressCallback: (downloaded) => {
                while (isPaused) {
                    // Wait while paused
                    new Promise(resolve => setTimeout(resolve, 100));
                }
                
                downloadedSize = downloaded;
                const currentTime = Date.now();
                const elapsedTime = (currentTime - startTime) / 1000; // time in seconds
                const speed = (downloaded / elapsedTime / (1024 * 1024)).toFixed(2); // MB/s
                const progress = totalSize ? Math.round((downloaded / totalSize) * 100) : 0;
                
                // Update only every second
                if (currentTime - lastUpdateTime >= 1000) {
                    const downloadedMB = (downloadedSize / (1024 * 1024)).toFixed(2);
                    const totalMB = (totalSize / (1024 * 1024)).toFixed(2);
                    parentPort.postMessage({ 
                        type: 'progress', 
                        fileName, 
                        progress, 
                        speed,
                        downloadedSize: downloadedMB,
                        totalSize: totalMB
                    });
                    lastUpdateTime = currentTime;
                }
            }
        });

        file.close();

        const finalElapsedTime = (Date.now() - startTime) / 1000;
        const finalSpeed = (totalSize / finalElapsedTime / (1024 * 1024)).toFixed(2);
        logger.info(`Download completed: ${fileName} - Total size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB, Average speed: ${finalSpeed} MB/s`);
        return { fileName, totalSize, finalSpeed };
    } catch (error) {
        logger.error(`Error during download of ${fileName}:`, error);
        file.close();
        fs.unlinkSync(fileName);  // Delete the incomplete file
        throw error;
    }
}

// Main function to process a Telegram link
async function processLink(link) {
    try {
        await client.connect();
        logger.info(`Processing link: ${link}`);
        const parts = link.split('/');
        let channelId, messageId;

        if (link.includes('t.me/c/')) {
            channelId = parseInt('-100' + parts[4]);
            messageId = parseInt(parts[parts.length - 1]);
        } else {
            throw new Error('Unsupported link');
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

processLink(link).catch(error => logger.error('Uncaught error in processLink:', error));