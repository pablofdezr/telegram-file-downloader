// Importación de módulos necesarios
import { workerData, parentPort } from "worker_threads";
import { TelegramClient } from "telegram/client/TelegramClient.js";
import { StringSession } from "telegram/sessions/StringSession.js";
import { Api } from "telegram/tl/api.js";
import fs from "fs";
import path from "path";
import logger from "./logger.js";
import mime from "mime-types";
import config from "./config.js";
import { nanoid } from "nanoid";

// Extracción de datos del worker pasados desde el hilo principal
const { link, stringSession, apiId, apiHash, downloadsPath, mode } = workerData;

// Inicialización del cliente de Telegram con la sesión y credenciales proporcionadas
const client = new TelegramClient(
  new StringSession(stringSession),
  apiId,
  apiHash,
  {
    connectionRetries: config.CONNECTION_RETRIES,
    timeout: config.CLIENT_TIMEOUT,
    useWSS: true,
  }
);

// Variables de control de descarga
let isPaused = false;
let isCancelled = false;

// Manejador de mensajes desde el hilo principal para control de descarga
parentPort.on("message", (message) => {
  switch (message.action) {
    case "pause":
      isPaused = true;
      logger.info("Download paused");
      break;
    case "resume":
      isPaused = false;
      logger.info("Download resumed");
      break;
    case "cancel":
      isCancelled = true;
      logger.info("Download cancelled");
      break;
    default:
      logger.warn(`Unknown action received: ${message.action}`);
  }
});

/**
 * Obtiene la extensión del archivo basada en el tipo MIME
 * @param {string} mimeType - Tipo MIME del archivo
 * @param {string} defaultExt - Extensión por defecto si el tipo MIME no es reconocido
 * @returns {string} Extensión del archivo
 */
function getFileExtension(mimeType, defaultExt = "bin") {
  return mime.extension(mimeType) || defaultExt;
}

/**
 * Obtiene la información del archivo de un mensaje de Telegram
 * @param {Object} message - Objeto de mensaje de Telegram
 * @returns {Object|null} Información del archivo o null si no hay medios descargables
 */
async function getFileInfo(message) {
  if (message.media) {
    if (message.media instanceof Api.MessageMediaDocument) {
      // Manejo de mensajes de documento (archivos, etc.)
      const document = message.media.document;
      let fileName = "unknown";
      let fileExtension = "bin";

      // Intenta obtener el nombre del archivo de los atributos del documento
      const fileNameAttr = document.attributes.find(
        (attr) => attr instanceof Api.DocumentAttributeFilename
      );
      if (fileNameAttr) {
        fileName = fileNameAttr.fileName;
        fileExtension =
          path.extname(fileName).slice(1) ||
          getFileExtension(document.mimeType, "bin");
      } else {
        fileExtension = getFileExtension(document.mimeType, "bin");
        fileName = `file.${fileExtension}`;
      }

      return {
        size: document.size,
        name: fileName,
        mimeType: document.mimeType,
        extension: fileExtension,
      };
    } else if (message.media instanceof Api.MessageMediaPhoto) {
      // Manejo de mensajes de foto
      const sizes = message.media.photo.sizes;
      const largestSize = sizes[sizes.length - 1];
      return {
        size: largestSize.size || 0,
        name: `photo_${message.media.photo.id}.jpg`,
        mimeType: "image/jpeg",
        extension: "jpg",
      };
    }
  }
  return null;
}

/**
 * Descarga medios de un mensaje de Telegram
 * @param {Object} message - Objeto de mensaje de Telegram
 * @returns {Promise<Object>} Resultado de la descarga
 */
async function downloadMedia(message) {
  try {
    const fileInfo = await getFileInfo(message);

    if (!fileInfo) {
      logger.warn("The message does not contain downloadable media.");
      return { error: "The message does not contain downloadable media." };
    }

    const nanoId = nanoid();
    const totalSize = fileInfo.size;
    const totalMB = (totalSize / (1024 * 1024)).toFixed(2);

    logger.info(
      `Preparing to download: ${fileInfo.name} (${fileInfo.mimeType}), size: ${totalMB} MB`
    );

    const fileName = path.join(downloadsPath, `${nanoId}_${fileInfo.name}`);

    let downloadedSize = 0;
    let startTime = Date.now();
    let lastUpdateTime = 0;

    const file = fs.createWriteStream(fileName);

    return new Promise((resolve, reject) => {
      client
        .downloadMedia(message.media, {
          outputFile: file,
          progressCallback: async (downloaded) => {
            // Manejo de pausa y cancelación
            while (isPaused && !isCancelled) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            if (isCancelled) {
              file.close();
              fs.unlink(fileName, () => {});
              reject(new Error("Download cancelled"));
              return;
            }

            downloadedSize = downloaded;
            const currentTime = Date.now();
            const elapsedTime = (currentTime - startTime) / 1000;
            const speed = (downloaded / elapsedTime / (1024 * 1024)).toFixed(2);
            const downloadedMB = (downloaded / (1024 * 1024)).toFixed(2);
            const progress = totalSize
              ? Math.round((downloaded / totalSize) * 100)
              : 0;

            // Envío de actualizaciones de progreso en intervalos especificados
            if (
              currentTime - lastUpdateTime >=
              config.PROGRESS_UPDATE_INTERVAL
            ) {
              const estimatedTotalTime = (elapsedTime / progress) * 100;
              const remainingTime = estimatedTotalTime - elapsedTime;

              parentPort.postMessage({
                type: "progress",
                fileName: fileInfo.name,
                progress,
                speed,
                downloadedSize: downloadedMB,
                totalSize: totalMB,
                elapsedTime: elapsedTime.toFixed(0),
                estimatedRemainingTime: remainingTime.toFixed(0),
              });
              lastUpdateTime = currentTime;
            }
          },
        })
        .then(() => {
          file.end(() => {
            const finalElapsedTime = (Date.now() - startTime) / 1000;
            const finalSpeed = (
              totalSize /
              finalElapsedTime /
              (1024 * 1024)
            ).toFixed(2);
            logger.info(
              `Download completed: ${fileName} - Total size: ${totalMB} MB, Average speed: ${finalSpeed} MB/s`
            );
            parentPort.postMessage({
              type: "complete",
              fileName: fileInfo.name,
              totalSize: totalMB,
              finalSpeed,
            });
            resolve({
              fileName: fileInfo.name,
              totalSize: totalMB,
              finalSpeed,
            });
          });
        })
        .catch((error) => {
          logger.error(`Error during download of ${fileName}:`, error);
          file.close(() => {
            fs.unlink(fileName, (err) => {
              if (err) logger.error(`Error deleting incomplete file: ${err}`);
              parentPort.postMessage({ type: "error", message: error.message });
              reject(error);
            });
          });
        });
    });
  } catch (error) {
    logger.error(`Error in downloadMedia: ${error.message}`);
    throw error;
  }
}

/**
 * Procesa un enlace de Telegram
 * @param {string} link - Enlace del mensaje de Telegram
 * @param {string} mode - Modo de descarga ('single' o 'rolling')
 */
async function processLink(link, mode = "single") {
  try {
    await client.connect();
    logger.info(`Processing link: ${link} in ${mode} mode`);

    if (mode === "rolling") {
      await rollingDownload(link);
    } else {
      // Lógica de descarga única existente
      let channelId, messageId;

      if (link.includes("t.me/c/")) {
        // Canal privado
        const parts = link.split("/");
        channelId = parseInt("-100" + parts[4]);
        messageId = parseInt(parts[parts.length - 1]);
      } else if (link.match(/t\.me\/[a-zA-Z0-9_]+\/\d+/)) {
        // Canal público
        const parts = link.split("/");
        const channelName = parts[3];
        messageId = parseInt(parts[4]);

        // Resolver el nombre de usuario del canal para obtener el ID del canal
        const resolveResult = await client.invoke(
          new Api.contacts.ResolveUsername({
            username: channelName,
          })
        );
        channelId = resolveResult.chats[0].id;
      } else {
        throw new Error("Unsupported link format");
      }

      const result = await client.invoke(
        new Api.channels.GetMessages({
          channel: channelId,
          id: [new Api.InputMessageID({ id: messageId })],
        })
      );

      if (result.messages && result.messages.length > 0) {
        const downloadResult = await downloadMedia(result.messages[0]);
        parentPort.postMessage({ type: "complete", ...downloadResult });
      } else {
        logger.warn("Message not found.");
        parentPort.postMessage({
          type: "error",
          message: "Message not found.",
        });
      }
    }
  } catch (error) {
    logger.error("Error processing link:", error);
    parentPort.postMessage({
      type: "error",
      message: `Error processing link: ${error.message}`,
    });
  } finally {
    await client.disconnect();
    logger.info("Client disconnected");
  }
}

/**
 * Realiza una descarga continua a partir de un mensaje específico
 * @param {string} initialLink - Enlace inicial del mensaje de Telegram
 */
async function rollingDownload(initialLink) {
  try {
    logger.info(`Starting rolling download from: ${initialLink}`);

    let currentMessageId;
    let channelId;

    if (initialLink.includes("t.me/c/")) {
      // Private channel
      const parts = initialLink.split("/");
      channelId = parseInt("-100" + parts[4]);
      currentMessageId = parseInt(parts[parts.length - 1]);
    } else if (initialLink.match(/t\.me\/[a-zA-Z0-9_]+\/\d+/)) {
      // Public channel
      const parts = initialLink.split("/");
      const channelName = parts[3];
      currentMessageId = parseInt(parts[4]);

      // Resolve the channel username to get the channel ID
      const resolveResult = await client.invoke(
        new Api.contacts.ResolveUsername({
          username: channelName,
        })
      );
      channelId = resolveResult.chats[0].id;
    } else {
      throw new Error("Unsupported link format");
    }

    // Intentar obtener el ID del último mensaje
    let lastMessageId;
    try {
      const channelInfo = await client.invoke(
        new Api.channels.GetFullChannel({
          channel: channelId,
        })
      );
      lastMessageId = channelInfo.full_chat?.read_inbox_max_id;
    } catch (error) {
      logger.warn(
        "Couldn't get last message ID from GetFullChannel, using alternative method"
      );
    }

    if (!lastMessageId) {
      // Método alternativo: obtener los mensajes más recientes y usar el ID del primero
      const recentMessages = await client.invoke(
        new Api.messages.GetHistory({
          peer: channelId,
          limit: 1,
        })
      );
      if (recentMessages.messages.length > 0) {
        lastMessageId = recentMessages.messages[0].id;
      } else {
        throw new Error("Couldn't determine the last message ID");
      }
    }

    logger.info(`Last message ID in the channel: ${lastMessageId}`);

    while (currentMessageId <= lastMessageId) {
      if (isCancelled) {
        logger.info("Rolling download cancelled");
        break;
      }

      try {
        const result = await client.invoke(
          new Api.channels.GetMessages({
            channel: channelId,
            id: [new Api.InputMessageID({ id: currentMessageId })],
          })
        );

        if (result.messages && result.messages.length > 0) {
          const message = result.messages[0];
          if (message.media) {
            logger.info(
              `Found multimedia message at ID ${currentMessageId}. Downloading...`
            );
            await downloadMedia(message);
          } else {
            logger.info(
              `Message ${currentMessageId} is not multimedia. Skipping.`
            );
          }
        } else {
          logger.warn(`No message found at ID ${currentMessageId}. Skipping.`);
        }

        currentMessageId++;
      } catch (error) {
        if (error.message.includes("MESSAGE_ID_INVALID")) {
          logger.warn(
            `Reached the end of the channel at message ID ${currentMessageId}. Stopping rolling download.`
          );
          break;
        }
        logger.error(`Error processing message ${currentMessageId}:`, error);
        // Try to continue with the next message
        currentMessageId++;
      }
    }

    logger.info("Reached the end of the channel. Stopping rolling download.");
  } catch (error) {
    logger.error("Error in rolling download:", error);
    parentPort.postMessage({
      type: "error",
      message: `Error in rolling download: ${error.message}`,
    });
  }
}

// Ejecución principal
processLink(link, mode).catch((error) => {
  logger.error("Uncaught error in processLink:", error);
  parentPort.postMessage({
    type: "error",
    message: `Uncaught error: ${error.message}`,
  });
});

// Manejo de errores no capturados
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Aplicación de lógica de manejo de errores específica aquí
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  // Aplicación de lógica de manejo de errores específica aquí
});
