// Required imports
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
import { promisify } from 'util';
import config from './config.js'; // Import configuration from a separate file

// Configuration setup
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

// Extract API credentials from environment variables
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

// Configuration validation
if (!apiId || !apiHash) {
  logger.error('API_ID and API_HASH must be defined in your .env file');
  process.exit(1);
}

// State variables
let activeWorkers = 0;
const linkQueue = [];
const downloads = new Map();

// Setup readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Promisify the readline question method for easier async usage
const question = promisify(rl.question).bind(rl);

// Function to select input mode
async function selectInputMode() {
  // Define the available choices
  const choices = ['Manual input', 'File input', 'Rolling input'];
  // Keep track of the currently selected index
  let selectedIndex = 0;

  // Function to render the choices in the console
  const renderChoices = () => {
    // Clear the console to provide a clean display
    console.clear();
    console.log('Select input mode:');
    // Iterate through the choices and display them
    choices.forEach((choice, index) => {
      // Highlight the currently selected choice with a '>' symbol
      if (index === selectedIndex) {
        console.log(`> ${choice}`);
      } else {
        console.log(`  ${choice}`);
      }
    });
    // Display instructions for navigation
    console.log('\nUse arrow keys to move and press Enter to select.');
  };

  // Initial render of the choices
  renderChoices();

  // Return a Promise that resolves when a choice is made
  return new Promise(resolve => {
    // Set up keypress events for user input
    readline.emitKeypressEvents(process.stdin);
    // If the input is from a terminal, enable raw mode for direct key capture
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    // Listen for keypress events
    process.stdin.on('keypress', (str, key) => {
      // Handle 'up' arrow key: move selection up if not at the top
      if (key.name === 'up' && selectedIndex > 0) {
        selectedIndex--;
        renderChoices();
      } 
      // Handle 'down' arrow key: move selection down if not at the bottom
      else if (key.name === 'down' && selectedIndex < choices.length - 1) {
        selectedIndex++;
        renderChoices();
      } 
      // Handle 'Enter' key: finalize selection
      else if (key.name === 'return') {
        // Disable raw mode to return to normal input handling
        process.stdin.setRawMode(false);
        // Resolve the promise with 'manual', 'file' or 'rolling' based on selection
        resolve(['manual', 'file', 'rolling'][selectedIndex]);
      }
    });
  });
}

// Function to create and manage a worker
async function createWorker(link, stringSession, mode) {
  const downloadsPath = path.join(os.homedir(), 'Downloads');
  const worker = new Worker('./worker.js', {
    workerData: { 
      link, 
      stringSession, 
      apiId: config.API_ID, 
      apiHash: config.API_HASH, 
      downloadsPath, 
      mode 
    }
  });

  const id = Date.now().toString();
  logger.info(`Starting download (mode: ${mode}): ${link}`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      logger.warn(`Download timeout for ${link}`);
      worker.terminate();
      reject(new Error('Download timeout'));
    }, config.DOWNLOAD_TIMEOUT);

    worker.on('message', (message) => {
      if (message.type === 'progress') {
        console.log(`Downloading ${message.fileName}: ${message.progress}% - ${message.speed} MB/s`);
      } else if (message.type === 'complete') {
        clearTimeout(timeout);
        console.log(`\n${message.fileName} downloaded. Total size: ${message.totalSize} MB, Average speed: ${message.finalSpeed} MB/s`);
        if (mode !== 'rolling') {
          resolve();
        }
      } else if (message.type === 'error') {
        clearTimeout(timeout);
        console.error(`\nError: ${message.message}`);
        reject(new Error(message.message));
      }
    });

    worker.on('error', (error) => {
      clearTimeout(timeout);
      logger.error('Worker error:', error);
      reject(error);
    });

    worker.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      } else if (mode === 'rolling') {
        resolve();
      }
    });
  });
}

// Function to update the download display
// TODO: Consider using a library like cli-progress for better visualization
function updateDownloadDisplay(id) {
    const download = downloads.get(id);
    if (download) {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(`Downloading ${download.fileName}: ${download.downloadedSize}/${download.totalSize} MB (${download.progress}%) - ${download.speed} MB/s`);
    }
}

// Function to process the link queue
async function processQueue() {
    while (linkQueue.length > 0 && activeWorkers < config.MAX_SIMULTANEOUS_DOWNLOADS) {
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

// Function to process a link
async function processLink(link) {
    // Validate the link format
    if (!validateTelegramLink(link)) {
        logger.warn(`Invalid Telegram link: ${link}`);
        return;
    }
    // Add the link to the queue
    linkQueue.push(link);
    // Start processing if we're not at max capacity
    if (activeWorkers < config.MAX_SIMULTANEOUS_DOWNLOADS) {
        processQueue();
    }
}

// Function to validate Telegram link format
function validateTelegramLink(link) {
    // This is a basic validation. Adjust as needed for your specific use case.
    return /^https?:\/\/t\.me\/c\//.test(link);
}

// Function to read links from a file
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
function handleUserInput() {
    rl.on('line', (input) => {
        switch (input.toLowerCase()) {
            case 'pause':
                downloads.forEach((download) => {
                    download.worker.postMessage({ action: 'pause' });
                });
                logger.info('All downloads paused');
                break;
            case 'resume':
                downloads.forEach((download) => {
                    download.worker.postMessage({ action: 'resume' });
                });
                logger.info('All downloads resumed');
                break;
            case 'status':
                console.log('\nCurrent downloads:');
                downloads.forEach((download, id) => {
                    console.log(`${download.fileName}: ${download.progress}% - ${download.speed} MB/s`);
                });
                break;
            default:
                logger.info('Unknown command. Available commands: pause, resume, status');
        }
    });
}

let client;

// Main function
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
        const mode = await selectInputMode();

        if (mode === 'file') {
            // Process URLs from a file
            const filePath = await question('Enter the path to the text file containing URLs: ');
            const links = await readLinksFromFile(filePath);
            for (const link of links) {
                await processLink(link);
            }
        } else {
            // Process URLs manually or in rolling mode
            while (true) {
      const link = await question('Enter a Telegram link (or "exit" to finish): ');
      if (link.toLowerCase() === 'exit') {
        break;
      }
      await createWorker(link, client.session.save(), mode);
    }
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

// Execute the main function
main().catch((error) => logger.error('Uncaught error:', error));