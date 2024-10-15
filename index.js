import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { Worker } from 'worker_threads';
import readline from 'readline';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import logger from './logger.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory name of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, '.env') });

// Parse API credentials from environment variables
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

// Check if API credentials are properly set
if (!apiId || !apiHash) {
  console.error('API_ID and API_HASH must be defined in your .env file');
  process.exit(1);
}

// Limit the number of simultaneous downloads
const MAX_SIMULTANEOUS_DOWNLOADS = 3;
let activeWorkers = 0;
const linkQueue = [];
const downloads = new Map();

// Set up readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Promisify readline question
function question(prompt) {
    return new Promise((resolve) => rl.question(prompt, resolve));
}

// Function to create a new worker for downloading a file
async function createWorker(link, stringSession) {
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const worker = new Worker('./worker.js', {
        workerData: { link, stringSession, apiId, apiHash, downloadsPath }
    });

    const id = Date.now().toString();
    logger.info(`Starting download: ${link}`);

    downloads.set(id, { worker, fileName: link, status: 'in progress', progress: 0, speed: 0, downloadedSize: 0, totalSize: 0 });

    return new Promise((resolve, reject) => {
        worker.on('message', (message) => {
            if (message.type === 'progress') {
                downloads.get(id).fileName = message.fileName;
                downloads.get(id).progress = message.progress;
                downloads.get(id).speed = message.speed;
                downloads.get(id).downloadedSize = message.downloadedSize;
                downloads.get(id).totalSize = message.totalSize;
                updateDownloadDisplay(id);
            } else if (message.type === 'complete') {
                process.stdout.write('\n');
                logger.info(`${message.fileName} downloaded. Total size: ${message.totalSize} MB, Average speed: ${message.finalSpeed} MB/s`);
                downloads.delete(id);
                resolve();
            } else if (message.type === 'error') {
                process.stdout.write('\n');
                logger.error(`Error: ${message.message}`);
                downloads.delete(id);
                reject(new Error(message.message));
            }
        });

        worker.on('error', (error) => {
            logger.error('Worker error:', error);
            reject(error);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                logger.error(`Worker stopped with exit code ${code}`);
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
}

// Function to update the download progress display
function updateDownloadDisplay(id) {
    const download = downloads.get(id);
    if (download) {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(`Downloading ${download.fileName}: ${download.downloadedSize}/${download.totalSize} MB (${download.progress}%) - ${download.speed} MB/s`);
    }
}

// Function to process the queue of download links
async function processQueue() {
    while (linkQueue.length > 0 && activeWorkers < MAX_SIMULTANEOUS_DOWNLOADS) {
        const link = linkQueue.shift();
        activeWorkers++;
        try {
            await createWorker(link, client.session.save());
        } catch (error) {
            logger.error(`Error processing link ${link}:`, error);
        } finally {
            activeWorkers--;
            processQueue();
        }
    }
}

// Function to add a link to the download queue
async function processLink(link) {
    linkQueue.push(link);
    if (activeWorkers < MAX_SIMULTANEOUS_DOWNLOADS) {
        processQueue();
    }
}

// Function to read links from a text file
async function readLinksFromFile(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        return fileContent.split('\n').filter(line => line.trim() !== '');
    } catch (error) {
        logger.error(`Error reading file: ${error.message}`);
        return [];
    }
}

// Function to save the session to a file
async function saveSession(session) {
    try {
        await fs.writeFile('session.json', JSON.stringify({ session }));
        logger.info('Session saved successfully');
    } catch (error) {
        logger.error('Error saving session:', error);
    }
}

// Function to load the session from a file
async function loadSession() {
    try {
        const data = await fs.readFile('session.json', 'utf8');
        return JSON.parse(data).session;
    } catch (error) {
        logger.info('No saved session found');
        return null;
    }
}

// Function to handle user input for pausing/resuming downloads
async function handleUserInput() {
    rl.on('line', (input) => {
        if (input.toLowerCase() === 'pause') {
            downloads.forEach((download) => {
                download.worker.postMessage({ action: 'pause' });
            });
            logger.info('All downloads paused');
        } else if (input.toLowerCase() === 'resume') {
            downloads.forEach((download) => {
                download.worker.postMessage({ action: 'resume' });
            });
            logger.info('All downloads resumed');
        } else if (input.toLowerCase() === 'status') {
            console.log('\nCurrent downloads:');
            downloads.forEach((download, id) => {
                console.log(`${download.fileName}: ${download.progress}% - ${download.speed} MB/s`);
            });
        }
    });
}

let client;

// Main function to run the script
async function main() {
    try {
        // Load saved session if available
        const savedSession = await loadSession();
        let useExistingSession = false;

        if (savedSession) {
            useExistingSession = (await question('Use existing session? (y/n): ')).toLowerCase() === 'y';
        }

        // Initialize Telegram client with saved session or create new one
        if (useExistingSession) {
            client = new TelegramClient(new StringSession(savedSession), apiId, apiHash, {
                connectionRetries: 5,
            });
        } else {
            client = new TelegramClient(new StringSession(""), apiId, apiHash, {
                connectionRetries: 5,
            });
        }

        // Start the Telegram client
        await client.start({
            phoneNumber: async () => await question('Phone number: '),
            password: async () => await question('Password: '),
            phoneCode: async () => await question('Code received: '),
            onError: (err) => logger.error(err),
        });

        logger.info('You are connected.');
        await saveSession(client.session.save());

        // Start handling user input
        handleUserInput();

        // Ask user for input mode
        const mode = await question('Enter "file" to process URLs from a text file, or "manual" for individual links: ');

        if (mode.toLowerCase() === 'file') {
            // Process URLs from a file
            const filePath = await question('Enter the path to the text file containing URLs: ');
            const links = await readLinksFromFile(filePath);
            for (const link of links) {
                await processLink(link);
            }
        } else if (mode.toLowerCase() === 'manual') {
            // Process URLs manually
            while (true) {
                const link = await question('Enter a Telegram link (or "exit" to finish): ');
                if (link.toLowerCase() === 'exit') {
                    break;
                }
                await processLink(link);
            }
        } else {
            logger.error('Invalid mode selected. Exiting.');
            process.exit(1);
        }

        // Wait for all downloads to complete
        while (activeWorkers > 0 || linkQueue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Clean up and exit
        rl.close();
        await client.disconnect();
        logger.info('Disconnected. Goodbye!');
        process.exit(0);
    } catch (error) {
        logger.error('Error in main:', error);
        process.exit(1);
    }
}

main().catch((error) => logger.error('Uncaught error:', error));