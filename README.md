![Telegram File Downloader](./assets/header.png)

# Telegram File Downloader

## Overview

Telegram File Downloader is a Node.js application that allows you to download files and media from Telegram channels and chats using message links. It supports concurrent downloads, progress tracking, and can handle large files efficiently.

## Features

- Download files and media from Telegram using message links
- Support for both public and private channels (with proper authentication)
- Concurrent downloads to maximize efficiency
- Real-time progress tracking for each download
- Pause, resume, and cancel functionality for downloads
- Session management for quick reconnection
- Detailed logging with daily rotation for easy troubleshooting
- Graceful error handling and recovery
- Option to read multiple links from a text file
- Configurable settings through environment variables and a central config file

## Prerequisites

Before you begin, ensure you have met the following requirements:

- Node.js (v14.0.0 or higher)
- npm (usually comes with Node.js)
- A Telegram account
- Telegram API credentials (api_id and api_hash)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/pablofdezr/telegram-file-downloader.git
   cd telegram-file-downloader
   ```

2. Install the dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory and add your Telegram API credentials:
   ```
   API_ID=your_api_id
   API_HASH=your_api_hash
   LOG_LEVEL=info
   NODE_ENV=development
   ```

   You can obtain these credentials by following the instructions at https://core.telegram.org/api/obtaining_api_id

## Configuration

The application uses a central `config.js` file for managing all settings. You can override these settings by adding them to your `.env` file. Some key configurations include:

- `MAX_SIMULTANEOUS_DOWNLOADS`: Maximum number of concurrent downloads (default: 3)
- `MAX_RETRIES`: Maximum number of retry attempts for failed downloads (default: 3)
- `DOWNLOAD_TIMEOUT`: Timeout for downloads in milliseconds (default: 300000)
- `LOG_LEVEL`: Logging level (default: 'info')
- `DOWNLOADS_PATH`: Path for downloaded files (default: user's Downloads folder)

## Usage

1. Start the application:
   ```
   npm start
   ```

2. On first run, you'll be prompted to enter your phone number and the authentication code sent to your Telegram account. In subsequent runs, you'll have the option to use the saved session.

3. Choose whether you want to input links manually or read them from a file:
   - For manual input, enter "manual"
   - To read from a file, enter "file" and then provide the path to your text file containing links (one per line)

4. If inputting manually, enter a Telegram message link when prompted. The link should be in the format:
   ```
   https://t.me/c/channel_id/message_id
   ```

5. The application will start downloading the file(s). You'll see real-time progress updates in the console.

6. To download another file (in manual mode), simply paste another link when prompted.

7. To exit the application, type 'exit' when prompted for a link (in manual mode).

## Commands

While downloads are in progress, you can use the following commands:

- `pause`: Pauses all current downloads
- `resume`: Resumes all paused downloads
- `status`: Displays the current status of all active downloads
- `cancel`: Cancels the current download (new feature)

## Logging

The application now uses Winston for advanced logging capabilities:

- Logs are rotated daily and stored in the configured `LOG_DIR`
- Separate log files for general logs (`application-%DATE%.log`) and errors (`error-%DATE%.log`)
- Console output is colorized for better readability
- Log level can be configured through the `LOG_LEVEL` environment variable

## Troubleshooting

If you encounter any issues:

1. Check the log files in the configured `LOG_DIR` for detailed messages.
2. Ensure your Telegram API credentials are correct in the `.env` file.
3. Verify that you have the necessary permissions to access the channel/chat.
4. Make sure you're using a compatible version of Node.js.
5. If you're having connection issues, try adjusting the `CONNECTION_RETRIES` and `CLIENT_TIMEOUT` settings in `config.js`.

## Contributing

Contributions to the Telegram File Downloader are welcome. Please feel free to submit a Pull Request. When contributing, please:

1. Fork the repository and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. Ensure your code lints.
4. Update the documentation.
5. Create a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This tool is for personal use only. Please respect Telegram's terms of service and the copyright of content owners. Do not use this tool to download or distribute copyrighted material without permission.