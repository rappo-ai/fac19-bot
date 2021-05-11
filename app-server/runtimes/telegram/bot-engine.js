const { get: getObjectProperty } = require('lodash/object');

const logger = require('../../logger');

const { answerCallbackQuery, editMessageText, forwardMessage, getCallbackData, getCallbackMessageId, getCallbackMessageText, getCallbackQueryId, getChatId, getMessageId, getMessageText, getReplyToMessageText, isCallbackQuery, isReplyToBot, isReplyToMessage, sendMessage } = require('../../utils/telegram');

const tracker = {
  store: {
    requests: {},
  },
};

function getTrackerForChat(chat_id) {
  if (!tracker[chat_id]) {
    tracker[chat_id] = {
      current_state_name: undefined,
      store: {
        cache: {}
      },
    };
  }
  return tracker[chat_id];
}

function getGlobalStore() {
  return tracker.store;
}

function getInlineKeyboard(text, chat_store, options = { remove_duplicates: true }) {
  const inline_keyboard = [];

  let reply_markup_text = text.match(/\[.+]/g);
  if (reply_markup_text && reply_markup_text.length) {
    reply_markup_text = reply_markup_text[0];
  }

  const _cache = [];
  if (reply_markup_text) {
    try {
      const button_rows = reply_markup_text.match(/\[[^\[\]]+]/gm);
      button_rows.forEach(row => {
        const reply_markup_row = [];
        const columns = row.slice(1, -1).trim().split(',').map(c => c.trim());
        let hasAtleastOneColumn = false;
        columns.forEach(column => {
          const callback_data = column;
          const text = replaceSlots(column, chat_store, "");
          //column = Buffer.from(column).toString('utf8', 0, 64); // restrict to 64 bytes (Telegram limit)
          if (text) {
            if (!options.remove_duplicates || !_cache.includes(text)) {
              reply_markup_row.push({
                text,
                callback_data,
              });
              _cache.push(text);
              hasAtleastOneColumn = true;
            }
          }
        });
        if (hasAtleastOneColumn) {
          inline_keyboard.push(reply_markup_row);
        }
      });
    } catch (err) {
      logger.error(`getInlineKeyboard ${err} `);
    }
  }
  return inline_keyboard;
}

function removeReplyMarkup(text) {
  const reply_markup = text.match(/\s*\[.+]/);
  if (reply_markup && reply_markup.length) {
    text = text.substring(0, reply_markup["index"]);
  }
  return text;
}

function replaceSlots(text, chat_store, default_slot_value = "") {
  const found_slots = [...text.matchAll(/{\s*[\w\.]+\s*}/g)];
  let delta = 0;
  found_slots.forEach(s => {
    const slot_key = s[0].slice(1, -1).trim();
    if (chat_store && getObjectProperty(chat_store, slot_key)) {
      text = text.substring(0, s["index"] + delta) + getObjectProperty(chat_store, slot_key) + text.substring(s["index"] + delta + s[0].length);
      delta = delta + getObjectProperty(chat_store, slot_key).length - s[0].length;
    } else {
      text = text.substring(0, s["index"] + delta) + default_slot_value + text.substring(s["index"] + delta + s[0].length);
      delta = delta + default_slot_value.length - s[0].length;
    }
  });
  return text;
}

function addMessageSlotsToStore(slots, chat_store, message_text, message_id) {
  if (slots) {
    for (const [data_key, slot_key] of Object.entries(slots)) {
      let slot_value;
      switch (data_key) {
        case "message_text":
          slot_value = message_text;
          break;
        case "message_id":
          slot_value = message_id;
          break;
        default:
          break;
      }
      chat_store[slot_key] = slot_value;
      chat_store["cache"][slot_key] = slot_value;
    }
  }
}
async function callFunction(action, update, chat_tracker, global_store, bot_definition) {
  let next_state_name;
  if (bot_definition.functions[action.method]) {
    try {
      next_state_name = await bot_definition.functions[action.method](update, chat_tracker, global_store, bot_definition);
      if (!next_state_name) {
        next_state_name = action.on_success;
      }
    } catch (err) {
      logger.error(`call_function ${err} `);
      next_state_name = action.on_failure;
    }
  }
  return next_state_name;
}

async function doBotAction(action, chat_tracker, global_store, update, bot_definition) {
  const chat_id = getChatId(update);
  let next_state_name;
  let api_response;
  if (action) {
    switch (action.type) {
      case "send_message":
        const reply_markup = { inline_keyboard: getInlineKeyboard(action.text, chat_tracker.store) };
        let text = removeReplyMarkup(action.text);
        text = replaceSlots(text, chat_tracker.store, action.default_slot_value || "");
        api_response = await sendMessage({ chat_id, text, reply_markup }, process.env.TELEGRAM_BOT_TOKEN);
        addMessageSlotsToStore(action.slots, chat_tracker.store, api_response.data.result.text, api_response.data.result.message_id);
        chat_tracker.last_message_sent = api_response.data.result;
        break;
      case "forward_message":
        const to_chat_id = replaceSlots(action.to, chat_tracker.store, "");
        const message_id = replaceSlots(action.message_id, chat_tracker.store, "");
        api_response = await forwardMessage({ chat_id: to_chat_id, from_chat_id: chat_id, message_id }, process.env.TELEGRAM_BOT_TOKEN);
        addMessageSlotsToStore(action.slots, chat_tracker.store, api_response.data.result.text, api_response.data.result.message_id);
        chat_tracker.last_message_sent = api_response.data.result;
        break;
      case "call_function":
        next_state_name = await callFunction(action, update, chat_tracker, global_store, bot_definition);
        break;
      case "goto_state":
        next_state_name = action.state;
        break;
      case "restart":
        Object.keys(chat_tracker.store.cache).forEach(key => delete chat_tracker.store.cache[key]);
        Object.keys(chat_tracker.store).forEach(key => key !== "cache" && delete chat_tracker.store[key]);
        next_state_name = bot_definition.start_state;
        break;
      default:
        break;
    }
  }
  return next_state_name;
}

async function doCommand(command_match, chat_tracker, global_store, update, bot_definition) {
  const command = bot_definition.commands.find(c => c.trigger === command_match[0]);
  if (command) {
    return doBotAction(command.action, chat_tracker, global_store, update, bot_definition);
  }
  const chat_id = getChatId(update);
  const api_response = await sendMessage({ chat_id, text: bot_definition.command_fallback }, process.env.TELEGRAM_BOT_TOKEN);
  chat_tracker.last_message_sent = api_response.data.result;
}

async function doFallback(bot_definition, chat_tracker, fallback_state, chat_id) {
  let api_response;
  if (fallback_state.fallback) {
    const reply_markup = { inline_keyboard: getInlineKeyboard(fallback_state.fallback, chat_tracker.store) };
    let text = removeReplyMarkup(fallback_state.fallback);
    text = replaceSlots(text, chat_tracker.store, "");
    api_response = await sendMessage({
      chat_id,
      text,
      reply_markup
    }, process.env.TELEGRAM_BOT_TOKEN);
    chat_tracker.last_message_sent = api_response.data.result;
    return api_response;
  }
  api_response = await sendMessage({ chat_id, text: bot_definition.default_fallback }, process.env.TELEGRAM_BOT_TOKEN);
  chat_tracker.last_message_sent = api_response.data.result;
}

async function processPMUpdate(update, chat_tracker, global_store, bot_definition) {
  const chat_id = getChatId(update);
  const message_id = getMessageId(update);

  if (!chat_id) {
    logger.warn("processPMUpdate !chat_id");
    return;
  }

  const message_text = getMessageText(update);
  const callback_data = replaceSlots(getCallbackData(update), chat_tracker.store);
  const callback_message_id = getCallbackMessageId(update);
  const user_response = message_text || callback_data || "";
  const current_state_name = chat_tracker.current_state_name;
  const current_state = bot_definition.states.find(s => s.name === current_state_name);

  const chat_store = chat_tracker.store;

  let next_state_name;
  let next_state_transition;

  try {
    if (isCallbackQuery(update)) {
      // must call answerCallbackQuery as per the docs (even if we don't show an alert)
      answerCallbackQuery({ callback_query_id: getCallbackQueryId(update) }, process.env.TELEGRAM_BOT_TOKEN).catch(err => logger.error(`answerCallbackQuery ${err} `));
    }
  } catch {
    logger.error(`processPMUpdate answerCallbackQuery ${err} `);
  }
  try {
    if (isCallbackQuery(update) && chat_id && callback_message_id) {
      // hiding the quick reply buttons when any one is clicked
      await editMessageText({
        chat_id,
        message_id: callback_message_id,
        text: `${update.callback_query.message.text} ${callback_data} `,
        entities: update.callback_query.message.entities,
        reply_markup: { inline_keyboard: [] }
      }, process.env.TELEGRAM_BOT_TOKEN);
    } else if (getObjectProperty(chat_tracker, "last_message_sent.reply_markup.inline_keyboard.length")) {
      // hiding the quick reply buttons when any new message is sent
      await editMessageText({
        chat_id,
        message_id: getObjectProperty(chat_tracker, "last_message_sent.message_id"),
        text: getObjectProperty(chat_tracker, "last_message_sent.text"),
        entities: getObjectProperty(chat_tracker, "last_message_sent.entities"),
        reply_markup: { inline_keyboard: [] }
      }, process.env.TELEGRAM_BOT_TOKEN);
    }
  } catch (err) {
    logger.error(`processPMUpdate editMessageText ${err} `);
  }

  const command_match = user_response.match(/(^\/[a-z]+)/);

  if (isReplyToMessage(update)) {
    const reply_to_message_text = getReplyToMessageText(update);
    const reply_to_message_lines = reply_to_message_text.split("\n");
    if (reply_to_message_lines && reply_to_message_lines.length) {
      const request_id = reply_to_message_lines[reply_to_message_lines.length - 1];
      const request_data = getObjectProperty(global_store, `requests.${request_id}.data`);
      if (request_data) {
        await doBotAction(
          { type: "call_function", method: "appendUserForm" },
          chat_tracker,
          global_store,
          update,
          bot_definition,
        );
        await doBotAction(
          { type: "goto_state", state: current_state_name },
          chat_tracker,
          global_store,
          update,
          bot_definition,
        );
        return;
      }
    }
  }

  if (isCallbackQuery(update)) {
    const callback_message_text = getCallbackMessageText(update);
    const callback_message_lines = callback_message_text.split("\n");
    if (callback_message_lines && callback_message_lines.length) {
      const request_id = callback_message_lines[callback_message_lines.length - 1];
      const request_data = getObjectProperty(global_store, `requests.${request_id}.data`);
      if (request_data) {
        await doBotAction(
          { type: "call_function", method: "cancelRequest" },
          chat_tracker,
          global_store,
          update,
          bot_definition,
        );
        await doBotAction(
          { type: "goto_state", state: current_state_name },
          chat_tracker,
          global_store,
          update,
          bot_definition,
        );
        return;
      }
    }
    // tbd - handle all callback queries here and return
  }

  if (command_match && command_match.length) {
    next_state_name = await doCommand(command_match, chat_tracker, global_store, update, bot_definition);
  } else if (current_state) {
    if (current_state.reset_slots) {
      Object.keys(chat_store).forEach(key => key !== "cache" && delete chat_store[key]);
    }

    if (current_state.validation) {
      if (!user_response.match(new RegExp(current_state.validation))) {
        await doFallback(bot_definition, chat_tracker, current_state, chat_id);
        return;
      }
    }

    addMessageSlotsToStore(current_state.slots, chat_store, user_response, message_id);

    if (current_state.transitions) {
      next_state_transition = current_state.transitions.find(t => t.on === user_response);
      if (next_state_transition) {
        next_state_name = next_state_transition.to;
      }
      if (!next_state_name) {
        next_state_transition = current_state.transitions.find(t => t.on === "*");
        if (next_state_transition) {
          next_state_name = next_state_transition.to;
        }
      }
    }

    if (!next_state_name) {
      await doFallback(bot_definition, chat_tracker, current_state, chat_id);
      return;
    }
  } else {
    next_state_name = bot_definition.start_state;
  }

  while (next_state_name) {
    chat_tracker.current_state_name = next_state_name;
    let action_list = bot_definition.states.find(s => s.name === next_state_name).action;
    if (!Array.isArray(action_list)) {
      action_list = [action_list];
    }
    for (let i = 0; i < action_list.length; ++i) {
      next_state_name = await doBotAction(action_list[i], chat_tracker, global_store, update, bot_definition);
      if (next_state_name) {
        break;
      }
    }
  }
}

async function processGroupUpdate(update, chat_tracker, global_store, bot_definition) {
  const reply_to_bot_action = getObjectProperty(bot_definition, "group.reply_to_bot.action");
  if (isReplyToBot(update) && reply_to_bot_action) {
    await doBotAction(reply_to_bot_action, chat_tracker, global_store, update, bot_definition);
  }

  if (isCallbackQuery(update)) {
    const callback_query_action = getObjectProperty(bot_definition, "group.callback_query.action");
    if (callback_query_action) {
      await doBotAction(callback_query_action, chat_tracker, global_store, update, bot_definition);
    }
    // must call answerCallbackQuery as per the docs (even if we don't show an alert)
    answerCallbackQuery({ callback_query_id: getCallbackQueryId(update) }, process.env.TELEGRAM_BOT_TOKEN).catch(err => logger.error(`answerCallbackQuery ${err} `));
  }
}

module.exports = {
  processPMUpdate,
  processGroupUpdate,
  getTrackerForChat,
  getGlobalStore,
  getInlineKeyboard,
  callFunction,
  doBotAction,
  removeReplyMarkup,
  replaceSlots,
};