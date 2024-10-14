# Telegram File Downloader

## Overview

Telegram File Downloader is a Node.js application that allows you to download files and media from Telegram channels and chats using message links. It supports concurrent downloads, progress tracking, and can handle large files efficiently.

## Features

- Download files and media from Telegram using message links
- Support for both public and private channels (with proper authentication)
- Concurrent downloads to maximize efficiency
- Real-time progress tracking for each download
- Pause and resume functionality for downloads
- Detailed logging for easy troubleshooting
- Graceful error handling and recovery

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
   ```

   You can obtain these credentials by following the instructions at https://core.telegram.org/api/obtaining_api_id

## Usage

1. Start the application:
   ```
   npm start
   ```

2. On first run, you'll be prompted to enter your phone number and the authentication code sent to your Telegram account.

3. Once authenticated, you'll be prompted to enter a Telegram message link. The link should be in the format:
   ```
   https://t.me/c/channel_id/message_id
   ```

4. The application will start downloading the file. You'll see real-time progress updates in the console.

5. To download another file, simply paste another link when prompted.

6. To exit the application, type 'exit' when prompted for a link.

## Commands

While a download is in progress, you can use the following commands:

- `pause`: Pauses the current download
- `resume`: Resumes a paused download
- `cancel`: Cancels the current download

## Troubleshooting

If you encounter any issues:

1. Check the `error.log` file for detailed error messages.
2. Ensure your Telegram API credentials are correct in the `.env` file.
3. Verify that you have the necessary permissions to access the channel/chat.
4. Make sure you're using a compatible version of Node.js.

## Contributing

Contributions to the Telegram File Downloader are welcome. Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This tool is for personal use only. Please respect Telegram's terms of service and the copyright of content owners. Do not use this tool to download or distribute copyrighted material without permission.