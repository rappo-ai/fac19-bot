const queue = require('async/queue');
const { get: getObjectProperty, has: hasObjectProperty } = require('lodash/object');

const bot_definition = require("./bot-definition");
bot_definition.functions = require('./bot-functions');
const { processPMUpdate, processGroupUpdate, getTrackerForChat, getGlobalStore, callFunction } = require('./bot-engine');
const logger = require('../../logger');
const { TELEGRAM_MESSAGE_TYPES, sendMessage, leaveChat, getChatId } = require('../../utils/telegram');

const bots = {};
const isInit = false;

function addBot(username, secret, callbacks) {
  bots[username] = {
    secret,
    callbacks,
    queue: {}
  };
}

function getChatQueue(botUsername, botSecret, chatId) {
  return bots[botUsername] && bots[botUsername].secret === botSecret &&
    (bots[botUsername].queue[chatId] || (bots[botUsername].queue[chatId] = queue(processUpdate, 1)));
}

function hasAnyKey(object, baseKey, keys) {
  return keys.some(key => hasObjectProperty(object, `${baseKey}.${key}`));
}

async function processUpdate(task, callback) {
  if (!isInit) {
    await callFunction(
      {
        type: "call_function",
        method: "init",
      },
      undefined,
      undefined,
      getGlobalStore(),
      bot_definition
    );
  }
  try {
    const chat_type = getObjectProperty(task, "update.message.chat.type") ||
      getObjectProperty(task, "update.my_chat_member.chat.type") ||
      getObjectProperty(task, "update.channel_post.chat.type") ||
      getObjectProperty(task, "update.callback_query.message.chat.type");

    const chat_text = getObjectProperty(task, "update.message.text");

    const new_chat_members = getObjectProperty(task, "update.message.new_chat_members");
    const my_chat_member_new_status = getObjectProperty(task, "update.my_chat_member.new_chat_member.status");
    switch (chat_type) {
      case "private":
        if (chat_text === "/start") {
          await bots[task.botUsername].callbacks.onPMChatJoin(task.update);
        } else if (my_chat_member_new_status === "kicked") {
          await bots[task.botUsername].callbacks.onPMChatBlocked(task.update);
        } else if (hasAnyKey(task, "update.message", TELEGRAM_MESSAGE_TYPES)) {
          await bots[task.botUsername].callbacks.onPMChatMessage(task.update);
        } else if (hasObjectProperty(task, "update.callback_query")) {
          await bots[task.botUsername].callbacks.onPMCallbackQuery(task.update);
        }
        break;

      case "group":
      case "supergroup":
        if (new_chat_members && new_chat_members.find(m => m.username === task.botUsername)) {
          await bots[task.botUsername].callbacks.onGroupChatJoin(task.update);
        } else if (my_chat_member_new_status === "left") {
          await bots[task.botUsername].callbacks.onGroupChatLeave(task.update);
        } else if (hasAnyKey(task, "update.message", TELEGRAM_MESSAGE_TYPES)) {
          await bots[task.botUsername].callbacks.onGroupChatMessage(task.update);
        } else if (hasObjectProperty(task, "update.callback_query")) {
          await bots[task.botUsername].callbacks.onGroupCallbackQuery(task.update);
        }
        break;

      case "channel":
        if (my_chat_member_new_status === "administrator") {
          await bots[task.botUsername].callbacks.onChannelJoin(task.update);
        } else if (my_chat_member_new_status === "left") {
          await bots[task.botUsername].callbacks.onChannelLeave(task.update);
        } else if (hasAnyKey(task, "update.channel_post", TELEGRAM_MESSAGE_TYPES)) {
          await bots[task.botUsername].callbacks.onChannelMessage(task.update);
        }
        break;

      default:
        break;
    }

  } catch (err) {
    logger.error(`processUpdate ${err}`);
    if (callback) {
      callback(err);
    }
  }
}

addBot(process.env.TELEGRAM_BOT_USERNAME, process.env.TELEGRAM_BOT_SECRET, {
  onPMChatJoin: async function (update) {
    logger.info(`@${process.env.TELEGRAM_BOT_USERNAME} started PM chat with ${update.message.from.first_name} | ${update.message.from.username} | ${update.message.from.id} `);
    return processPMUpdate(update, getTrackerForChat(getChatId(update)), getGlobalStore(), bot_definition);
  },
  onPMChatMessage: async function (update) {
    return processPMUpdate(update, getTrackerForChat(getChatId(update)), getGlobalStore(), bot_definition);
  },
  onPMCallbackQuery: async function (update) {
    return processPMUpdate(update, getTrackerForChat(getChatId(update)), getGlobalStore(), bot_definition);
  },
  onPMChatBlocked: async function (update) {
    logger.info(`@${process.env.TELEGRAM_BOT_USERNAME} blocked by ${update.my_chat_member.from.first_name} | ${update.my_chat_member.from.username} | ${update.my_chat_member.from.id}`);
  },
  onGroupChatJoin: async function (update) {
    logger.info(`@${process.env.TELEGRAM_BOT_USERNAME} joined group ${update.message.chat.title} | ${update.message.chat.id} by ${update.message.from.first_name} | ${update.message.from.username} | ${update.message.from.id} `);
  },
  onGroupChatMessage: async function (update) {
    return processGroupUpdate(update, getTrackerForChat(getChatId(update)), getGlobalStore(), bot_definition);
  },
  onGroupCallbackQuery: async function (update) {
    return processGroupUpdate(update, getTrackerForChat(getChatId(update)), getGlobalStore(), bot_definition);
  },
  onGroupChatLeave: async function (update) {
    logger.info(`@${process.env.TELEGRAM_BOT_USERNAME} kicked in group ${update.my_chat_member.chat.title} | ${update.my_chat_member.chat.id} by ${update.my_chat_member.from.first_name} | ${update.my_chat_member.from.username} | ${update.my_chat_member.from.id} `);
  },
  onChannelJoin: async function (update) {
    await sendMessage({ chat_id: update.my_chat_member.chat.id, text: 'This bot is not designed to be used in a channel and will leave the channel shortly.' },
      process.env.TELEGRAM_BOT_TOKEN);
    await leaveChat({ chat_id: update.my_chat_member.chat.id }, process.env.TELEGRAM_BOT_TOKEN);
    logger.info(`@${process.env.TELEGRAM_BOT_USERNAME} joined channel ${update.my_chat_member.chat.title} | ${update.my_chat_member.chat.id} by ${update.my_chat_member.from.first_name} | ${update.my_chat_member.from.username} | ${update.my_chat_member.from.id} `);
  },
  onChannelMessage: async function (update) {
    logger.warn(`@${process.env.TELEGRAM_BOT_USERNAME} used in channel ${update.my_chat_member.chat.title} | ${update.my_chat_member.chat.id} `)
  },
  onChannelLeave: async function (update) {
    logger.info(`@${process.env.TELEGRAM_BOT_USERNAME} kicked in channel ${update.my_chat_member.chat.title} | ${update.my_chat_member.chat.id} by ${update.my_chat_member.from.first_name} | ${update.my_chat_member.from.username} | ${update.my_chat_member.from.id} `);
  },
});

module.exports = {
  getChatQueue,
};
