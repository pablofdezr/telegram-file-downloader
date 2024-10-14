import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { Worker } from 'worker_threads';
import readline from 'readline';
import os from 'os';
import logger from './logger.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory name of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, '.env') });

// Now you can use process.env to access your environment variables
// We need parseInt to convert the string to an integer
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

// Make sure the variables are defined
if (!apiId || !apiHash) {
  console.error('API_ID and API_HASH must be defined in your .env file');
  process.exit(1);
}

const stringSession = new StringSession('');

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

const MAX_WORKERS = os.cpus().length;
let activeWorkers = 0;
const linkQueue = [];
const downloads = new Map();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => rl.question(prompt, resolve));
}

// Function to create a new worker for downloading a file
async function createWorker(link) {
    const worker = new Worker('./worker.js', {
        workerData: { link, stringSession: client.session.save(), apiId, apiHash }
    });

    const id = Date.now().toString();
    logger.info(`Starting download: ${link}`);

    downloads.set(id, { worker, fileName: link, status: 'in progress', progress: 0, speed: 0, downloadedSize: 0, totalSize: 0 });

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
        } else if (message.type === 'error') {
            process.stdout.write('\n');
            logger.error(`Error: ${message.message}`);
            downloads.delete(id);
        }
    });

    worker.on('error', (error) => logger.error('Worker error:', error));

    worker.on('exit', (code) => {
        if (code !== 0) {
            logger.error(`Worker stopped with exit code ${code}`);
        }
        activeWorkers--;
        processQueue();
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
function processQueue() {
    while (linkQueue.length > 0 && activeWorkers < MAX_WORKERS) {
        const link = linkQueue.shift();
        activeWorkers++;
        createWorker(link).catch(console.error);
    }
}

// Function to add a link to the download queue
async function processLink(link) {
    linkQueue.push(link);
    processQueue();
}

// Main function to run the script
async function main() {
    try {
        // Start the Telegram client
        await client.start({
            phoneNumber: async () => await question('Phone number: '),
            password: async () => await question('Password: '),
            phoneCode: async () => await question('Code received: '),
            onError: (err) => logger.error(err),
        });

        logger.info('You are connected.');
        logger.info('Session saved:', client.session.save());

        // Main loop to process download links
        while (true) {
            const link = await question('Enter a Telegram link (or "exit" to finish): ');
            if (link.toLowerCase() === 'exit') {
                break;
            }
            await processLink(link);
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