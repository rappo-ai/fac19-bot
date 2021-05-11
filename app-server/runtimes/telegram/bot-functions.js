const { get: getObjectProperty, set: setObjectProperty } = require('lodash/object');
const { nanoid } = require('nanoid');

const { doBotAction, getInlineKeyboard, getTrackerForChat, removeReplyMarkup, replaceSlots } = require('./bot-engine');

const logger = require('../../logger');
const { formatDate } = require('../../utils/date');
const { addRow, createSpreadsheet, updateRow } = require('../../utils/google-sheets');
const { deleteMessage, getCallbackData, getCallbackMessageId, getCallbackMessageText, getChatId, getDateMs, getFirstName, getLastName, getMessageId, getMessageText, getReplyToMessageText, getUserName, sendMessage } = require('../../utils/telegram');

// tbd - move all strings into this dictionary
const en_strings = {
  "waiting_for_response": "Your message has been recorded. We are trying our best to help, but until we revert back to you with an update please dial 1912 or 108 for beds.\n\nWe wish a speedy recovery for your loved ones.",
};

function getDisplayName(user_name, first_name, last_name) {
  return `${user_name ? `@${user_name}` : (first_name || "") + first_name && " " + (last_name || "")}`;
}

async function createRequestId(data, global_store) {
  const request_id = nanoid();
  const request_data = Object.assign({}, data);
  if (request_data["cache"]) {
    delete request_data["cache"];
  }
  global_store["requests"][request_id] = {
    request_id,
    data: request_data,
    status: "open",
    active_chats: [],
    admin_thread_message_id: "",
    admin_thread_message_text: "",
  };

  const sheet_data = Object.assign({}, data);
  sheet_data["request_id"] = request_id;
  sheet_data["creation_time"] = formatDate(Date.now());
  await addRow(process.env.SPREADSHEET_ID, sheet_data);

  return request_id;
}

function getRequestIdForSrfId(srf_id, global_store) {
  // tbd - read from DB / spreadsheet
  return srf_id && Object.keys(global_store["requests"]).find(key => getObjectProperty(global_store, `requests.${key}.data.srf_id`) === srf_id);
}

async function updateAdminThread(request_id, raw_message, sent_by, replied_by, date, new_reply_markup, global_store) {
  const patient_name = getObjectProperty(global_store, `requests.${request_id}.data.name`, "");
  const srf_id = getObjectProperty(global_store, `requests.${request_id}.data.srf_id`, "");
  const status = getObjectProperty(global_store, `requests.${request_id}.status`, "open");
  const admin_thread_message_id = getObjectProperty(global_store, `requests.${request_id}.admin_thread_message_id`, "");
  let admin_thread_message_text = getObjectProperty(global_store, `requests.${request_id}.admin_thread_message_text`, "");

  let status_text;
  switch (status) {
    case "closed":
      status_text = "STATUS: CLOSED";
      break;
    case "open":
    default:
      status_text = "STATUS: OPEN";
      break;
  }
  let new_admin_thread_message_text;
  if (admin_thread_message_text) {
    const admin_thread_message_lines = admin_thread_message_text.split("\n");
    const new_message_lines = [];
    admin_thread_message_lines.forEach(line => {
      if (line.startsWith("STATUS")) {
        line = status_text;
      }
      new_message_lines.push(line);
      if (line.startsWith("STATUS")) {
        new_message_lines.push("");
        if (sent_by) {
          new_message_lines.push(`Sent by ${sent_by} on ${formatDate(date)} `);
        } else if (replied_by) {
          new_message_lines.push(`Replied by ${replied_by} on ${formatDate(date)} `);
        }
        new_message_lines.push("");
        new_message_lines.push(raw_message);
      }
    });
    new_admin_thread_message_text = new_message_lines.join("\n");
  } else {
    new_admin_thread_message_text = `${status_text}\n\nSent by ${sent_by} on ${formatDate(date)}${patient_name && `\nPatient Name: ${patient_name}`}${srf_id && `\nSRF ID: ${srf_id}`}\n\n${raw_message}\n\nReply to this message to send a message to user in PM.\n\n${request_id}`;
  }

  // send new message
  api_response = await sendMessage({
    chat_id: process.env.TELEGRAM_ADMIN_GROUP_CHAT_ID,
    text: new_admin_thread_message_text,
    reply_markup: new_reply_markup,
  }, process.env.TELEGRAM_BOT_TOKEN);

  // cache the message sent
  setObjectProperty(global_store, `requests.${request_id}.admin_thread_message_text`, new_admin_thread_message_text);

  // cache the new admin_thread_message_id
  setObjectProperty(global_store, `requests.${request_id}.admin_thread_message_id`, api_response.data.result.message_id);

  if (admin_thread_message_id) {
    // delete previous message
    api_response = await deleteMessage({
      chat_id: process.env.TELEGRAM_ADMIN_GROUP_CHAT_ID,
      message_id: admin_thread_message_id,
    }, process.env.TELEGRAM_BOT_TOKEN);
  }

  const active_chats = getObjectProperty(global_store, `requests.${request_id}.active_chats`, []);
  await updateRow(process.env.SPREADSHEET_ID, { key: "request_id", value: request_id }, {
    status,
    last_update_time: formatDate(Date.now()),
    admin_thread_message_id: api_response.data.result.message_id,
    admin_thread_message_text: new_admin_thread_message_text,
    active_chats: active_chats.join(', '),
  });
}

async function updateUserThread(request_id, chat_id, reply_to_message_id, raw_message, reply_markup, global_store) {
  const patient_name = getObjectProperty(global_store, `requests.${request_id}.data.name`, "");
  const srf_id = getObjectProperty(global_store, `requests.${request_id}.data.srf_id`, "");
  const status = getObjectProperty(global_store, `requests.${request_id}.status`, "open");
  const active_chats = getObjectProperty(global_store, `requests.${request_id}.active_chats`);
  const is_user_request_open = (status === "open") && active_chats.includes(chat_id);
  const message_text = `${patient_name && `Patient Name: ${patient_name}`}${srf_id && `\nSRF ID: ${srf_id}`}

${raw_message}${is_user_request_open ? "\n\nReply to this message to send any extra info for this request." : ""}

${request_id}`;

  await sendMessage({
    chat_id,
    text: message_text,
    reply_markup,
    reply_to_message_id,
  }, process.env.TELEGRAM_BOT_TOKEN);
}

const functions = {
  "init": async function (update, chat_tracker, global_store, bot_definition) {
    await createSpreadsheet(process.env.SPREADSHEET_ID, bot_definition.spreadsheet_headers);
  },
  "submitForm": async function (update, chat_tracker, global_store, bot_definition) {
    const srf_id = chat_tracker.store["srf_id"];
    const has_forward_message = !!chat_tracker.store["forward_message"];
    let request_id = getRequestIdForSrfId(srf_id, global_store);
    if (!request_id) {
      request_id = await createRequestId(chat_tracker.store, global_store);
    } else {
      setObjectProperty(global_store, `requests.${request_id}.status`, "open");
      if (has_forward_message) {
        setObjectProperty(global_store, `requests.${request_id}.data.forward_message`, chat_tracker.store.forward_message);
      } else {
        const previous_forward_message = getObjectProperty(global_store, `requests.${request_id}.data.forward_message`);
        setObjectProperty(global_store, `requests.${request_id}.data`, Object.assign({}, chat_tracker.store));
        setObjectProperty(global_store, `requests.${request_id}.data.forward_message`, previous_forward_message);
      }
      await updateRow(process.env.SPREADSHEET_ID, { key: "request_id", value: request_id }, {
        last_update_time: formatDate(Date.now()),
        ...getObjectProperty(global_store, `requests.${request_id}.data`, {}),
      });
    }

    const chat_id = getChatId(update);
    const user_name = getUserName(update);
    const first_name = getFirstName(update);
    const last_name = getLastName(update);
    const date = getDateMs(update);
    const user_display_name = getDisplayName(user_name, first_name, last_name);

    const active_chats = getObjectProperty(global_store, `requests.${request_id}.active_chats`, []);
    if (!active_chats.includes(chat_id)) {
      active_chats.push(chat_id);
    }
    setObjectProperty(global_store, `requests.${request_id}.active_chats`, active_chats);

    let admin_thread_update_text = has_forward_message ? `{ forward_message }` : `Requirement: { requirement }
SPO2 level: { spo2 }
Bed type: { bed_type }
Needs cylinder: { needs_cylinder }
Covid test done ?: { covid_test_done }
Covid test result: { covid_test_result }
CT scan done ?: { ct_scan_done }
CT score: { ct_score }
BU number: { bu_number }
SRF ID: { srf_id }
Name: { name }
Age: { age }
Gender: { gender }
Blood group: { blood_group }
Mobile number: { mobile_number }
Alt mobile number: { alt_mobile_number }
Address: { address }
Hospital preference: { hospital_preference }`;

    admin_thread_update_text = replaceSlots(admin_thread_update_text, chat_tracker.store, "N/A");
    const admin_reply_markup = { inline_keyboard: getInlineKeyboard("[[Close Request]]") };
    await updateAdminThread(request_id, admin_thread_update_text, user_display_name, "", date, admin_reply_markup, global_store);

    const user_reply_markup = { inline_keyboard: getInlineKeyboard("[[Cancel Request]]") };
    await updateUserThread(request_id, chat_id, undefined, en_strings["waiting_for_response"], user_reply_markup, global_store);
  },

  "appendUserForm": async function (update, chat_tracker, global_store, bot_definition) {
    const reply_to_message_text = getReplyToMessageText(update);
    const reply_to_message_lines = reply_to_message_text.split("\n");
    const request_id = reply_to_message_lines && reply_to_message_lines.length && reply_to_message_lines[reply_to_message_lines.length - 1];
    if (!request_id) {
      throw new Error("appendUserForm request_id missing");
    }

    const chat_id = getChatId(update);
    const active_chats = getObjectProperty(global_store, `requests.${request_id}.active_chats`);
    if (!active_chats.includes(chat_id)) {
      const user_reply_markup = { inline_keyboard: [] };
      await updateUserThread(request_id, chat_id, getMessageId(update), "This request is closed. Submit a new request with same SRF ID to re-open the request.", user_reply_markup, global_store);
      return;
    }

    const admin_thread_update_text = getMessageText(update);
    const user_name = getUserName(update);
    const first_name = getFirstName(update);
    const last_name = getLastName(update);
    const user_display_name = getDisplayName(user_name, first_name, last_name);
    const date = getDateMs(update);
    const admin_reply_markup = { inline_keyboard: getInlineKeyboard("[[Close Request]]") };
    await updateAdminThread(request_id, admin_thread_update_text, user_display_name, "", date, admin_reply_markup, global_store);

    const user_reply_markup = { inline_keyboard: getInlineKeyboard("[[Cancel Request]]") };
    await updateUserThread(request_id, chat_id, getMessageId(update), en_strings["waiting_for_response"], user_reply_markup, global_store);
  },

  "cancelRequest": async function (update, chat_tracker, global_store, bot_definition) {
    const callback_message_text = getCallbackMessageText(update);
    const callback_message_lines = callback_message_text.split("\n");
    const request_id = callback_message_lines && callback_message_lines.length && callback_message_lines[callback_message_lines.length - 1];
    if (!request_id) {
      throw new Error("cancelRequest request_id missing");
    }

    const chat_id = getChatId(update);
    const status = getObjectProperty(global_store, `requests.${request_id}.status`);
    let active_chats = getObjectProperty(global_store, `requests.${request_id}.active_chats`, []);
    const is_request_closed = status !== "open";
    if (!active_chats.includes(chat_id) || is_request_closed) {
      await updateUserThread(
        request_id,
        chat_id,
        getCallbackMessageId(update),
        "This request is closed. Submit a new request with same SRF ID to re-open the request.",
        { inline_keyboard: [] },
        global_store);
      return;
    }

    active_chats = active_chats.filter(c => c !== chat_id);
    const is_request_cancelled = active_chats.length === 0;

    setObjectProperty(global_store, `requests.${request_id}.active_chats`, active_chats);
    if (is_request_cancelled) {
      setObjectProperty(global_store, `requests.${request_id}.status`, "closed");
    }

    const admin_thread_update_text = "< User cancelled the request >";
    const user_name = getUserName(update);
    const first_name = getFirstName(update);
    const last_name = getLastName(update);
    const user_display_name = getDisplayName(user_name, first_name, last_name);
    const date = getDateMs(update);
    const admin_reply_markup = { inline_keyboard: is_request_cancelled ? [] : getInlineKeyboard("[[Close Request]]") };
    await updateAdminThread(request_id, admin_thread_update_text, user_display_name, "", date, admin_reply_markup, global_store);

    const user_reply_markup = { inline_keyboard: [] };
    await updateUserThread(
      request_id,
      chat_id,
      getCallbackMessageId(update),
      "Your request has been successfully cancelled.",
      user_reply_markup,
      global_store);
  },

  "appendAdminForm": async function (update, chat_tracker, global_store, bot_definition) {
    const reply_to_message_text = getReplyToMessageText(update);
    const reply_to_message_lines = reply_to_message_text.split("\n");
    const request_id = reply_to_message_lines && reply_to_message_lines.length && reply_to_message_lines[reply_to_message_lines.length - 1];
    if (!request_id) {
      throw new Error("appendAdminForm request_id missing");
    }

    const admin_user_name = getUserName(update);
    const admin_first_name = getFirstName(update);
    const admin_last_name = getLastName(update);
    const admin_display_name = getDisplayName(admin_user_name, admin_first_name, admin_last_name);
    const date = getDateMs(update);

    const admin_thread_update_text = getMessageText(update);
    const active_chats = getObjectProperty(global_store, `requests.${request_id}.active_chats`);
    if (!active_chats || !active_chats.length) {
      const admin_reply_markup = { inline_keyboard: [] };
      await updateAdminThread(request_id, `This request is closed and the below message has been ignored: \n\n${admin_thread_update_text} `, "", admin_display_name, date, admin_reply_markup, global_store);
      return;
    }

    const admin_reply_markup = { inline_keyboard: getInlineKeyboard("[[Close Request]]") };
    await updateAdminThread(request_id, admin_thread_update_text, "", admin_display_name, date, admin_reply_markup, global_store);

    try {
      // delete the reply message
      await deleteMessage({
        chat_id: process.env.TELEGRAM_ADMIN_GROUP_CHAT_ID,
        message_id: update.message.message_id,
      }, process.env.TELEGRAM_BOT_TOKEN);
    } catch (err) {
      logger.err(`appendAdminForm ${err} `);
      logger.warn('bot may not be an admin in the group');
    }

    // user responses
    const update_user_thread_promises = [];
    for (let i = 0; i < active_chats.length; ++i) {
      const chat_id = active_chats[i];
      const user_reply_markup = { inline_keyboard: getInlineKeyboard("[[Cancel Request]]") };
      update_user_thread_promises.push(updateUserThread(
        request_id,
        chat_id,
        undefined,
        admin_thread_update_text,
        user_reply_markup,
        global_store)
      );
      update_user_thread_promises.push(doBotAction({
        type: "goto_state",
        state: getTrackerForChat(chat_id).current_state_name,
      }, getTrackerForChat(chat_id), global_store, update, functions, bot_definition));
    }
    await Promise.all(update_user_thread_promises);
  },

  "handleAdminCallback": async function (update, chat_tracker, global_store, bot_definition) {
    const callback_data = replaceSlots(getCallbackData(update), chat_tracker.store);
    switch (callback_data) {
      case "Close Request":
        const callback_message_text = getCallbackMessageText(update);
        const callback_message_lines = callback_message_text.split("\n");
        const request_id = callback_message_lines && callback_message_lines.length && callback_message_lines[callback_message_lines.length - 1];
        if (!request_id) {
          throw new Error("cancelRequest request_id missing");
        }

        const admin_user_name = getUserName(update);
        const admin_first_name = getFirstName(update);
        const admin_last_name = getLastName(update);
        const admin_display_name = getDisplayName(admin_user_name, admin_first_name, admin_last_name);
        const date = getDateMs(update);
        const admin_reply_markup = { inline_keyboard: [] };

        const status = getObjectProperty(global_store, `requests.${request_id}.status`);
        const active_chats = getObjectProperty(global_store, `requests.${request_id}.active_chats`);
        const is_request_closed = status !== "open";
        if (is_request_closed || !active_chats || !active_chats.length) {
          await updateAdminThread(request_id, "This request has already been closed.", "", admin_display_name, date, admin_reply_markup, global_store);
          return;
        }

        setObjectProperty(global_store, `requests.${request_id}.status`, "closed");
        setObjectProperty(global_store, `requests.${request_id}.active_chats`, []);

        const admin_thread_update_text = `< ${admin_display_name} closed the request > `;
        await updateAdminThread(request_id, admin_thread_update_text, "", admin_display_name, date, admin_reply_markup, global_store);

        // user responses
        const update_user_thread_promises = [];
        for (let i = 0; i < active_chats.length; ++i) {
          const chat_id = active_chats[i];
          const user_reply_markup = { inline_keyboard: [] };
          update_user_thread_promises.push(updateUserThread(
            request_id,
            chat_id,
            undefined,
            "Your request has been closed.",
            user_reply_markup,
            global_store)
          );
          update_user_thread_promises.push(doBotAction({
            type: "goto_state",
            state: getTrackerForChat(chat_id).current_state_name,
          }, getTrackerForChat(chat_id), global_store, update, functions, bot_definition));
        }
        await Promise.all(update_user_thread_promises);
        break;
    }
  },

  "ctBlockNextState": async function (update, chat_tracker, global_store, bot_definition) {
    const covid_test_done = chat_tracker.store["covid_test_done"];
    return (covid_test_done && covid_test_done === "Yes") ? "bu_number" : "collect_personal_details";
  },

  "validateForwardTemplate": async function (update, chat_tracker, global_store, bot_definition) {
    const chat_id = getChatId(update);
    const message_text = getMessageText(update);
    const slots_to_validate = ["name", "age", "address", "spo2", "mobile_number", "srf_id"];
    let srf_id;
    const srf_id_match = message_text.match(/\d{13}/);
    if (srf_id_match) {
      srf_id = srf_id_match[0];
    }
    const is_valid_template = !!srf_id;
    // tbd  - validate the above slots and add the result in is_valid_template
    if (!is_valid_template) {
      await sendMessage({
        chat_id,
        text: `The template is invalid.Please make sure your request has a 13 - digit SRF ID and send the template again.`,
        reply_markup: { inline_keyboard: getInlineKeyboard("[[Cancel]]") },
      }, process.env.TELEGRAM_BOT_TOKEN);
      return "forward_template_retry";
    }
    chat_tracker.store["srf_id"] = chat_tracker.store["cache"]["srf_id"] = srf_id;
    return "check_duplicate_forward_srf_id";
  },

  "checkDuplicateSrfId": async function (update, chat_tracker, global_store, bot_definition) {
    let srf_id = chat_tracker.store["srf_id"];
    if (srf_id.search(/^\d{13}$/) === -1) {
      srf_id = chat_tracker.store["srf_id"] = chat_tracker.store["cache"]["srf_id"] = "";
      return "requirement";
    }
    const request_id = getRequestIdForSrfId(srf_id, global_store);
    if (!request_id) {
      return "requirement";
    }

    return "confirm_duplicate_update";
  },

  "checkDuplicateForwardSrfId": async function (update, chat_tracker, global_store, bot_definition) {
    const srf_id = chat_tracker.store["srf_id"];
    const request_id = getRequestIdForSrfId(srf_id, global_store);
    if (!request_id) {
      return "forward_summary";
    }

    return "confirm_duplicate_update";
  },

  "confirmDuplicateUpdate": async function (update, chat_tracker, global_store, bot_definition) {
    const srf_id = chat_tracker.store["srf_id"];
    const request_id = getRequestIdForSrfId(srf_id, global_store);
    const patient_name = getObjectProperty(global_store, `requests.${request_id}.data.name`, "");
    const forward_message = getObjectProperty(global_store, `requests.${request_id}.data.forward_message`, "");
    const message_raw_text = "A request for this SRF ID already exists with the following details:" +
      (patient_name && "\n\nRequirement: {requirement}\nSPO2 level: {spo2}\nBed type: {bed_type}\nNeeds cylinder: {needs_cylinder}\nCovid test result: {covid_test_result}\nCT Scan done?: {ct_scan_done}\nCT Score: {ct_score}\nBU number: {bu_number}\nSRF ID: {srf_id}\nName: {name}\nAge: {age}\nGender: {gender}\nBlood group: {blood_group}\nMobile number: {mobile_number}\nAlt mobile number: {alt_mobile_number}\nAddress: {address}\nHospital preference: {hospital_preference}") +
      (forward_message && "\n\n{forward_message}") +
      "\n\nDo you want to update this request? [[Yes, No]]";
    const slots_store = getObjectProperty(global_store, `requests.${request_id}.data`, {});
    const reply_markup = { inline_keyboard: getInlineKeyboard(message_raw_text, chat_tracker.store) };
    let message_text = removeReplyMarkup(message_raw_text);
    message_text = replaceSlots(message_text, slots_store, "N/A");

    const chat_id = getChatId(update);
    await sendMessage({
      chat_id,
      text: message_text,
      reply_markup,
    }, process.env.TELEGRAM_BOT_TOKEN);

    return "confirm_duplicate_update_wait";
  },

  "updateDuplicate": async function (update, chat_tracker, global_store, bot_definition) {
    const is_forward_update = !!chat_tracker.store["forward_message"];
    if (!is_forward_update) {
      const srf_id = chat_tracker.store["srf_id"];
      const request_id = getRequestIdForSrfId(srf_id, global_store);
      chat_tracker.store = Object.assign({}, getObjectProperty(global_store, `requests.${request_id}.data`));
      chat_tracker.store["cache"] = Object.assign({}, getObjectProperty(global_store, `requests.${request_id}.data`));
      chat_tracker.store.forward_message = chat_tracker.store["cache"].forward_message = "";
    }

    return is_forward_update ? "forward_summary" : "requirement";
  },

  "checkSpo2": async function (update, chat_tracker, global_store, bot_definition) {
    const spo2 = chat_tracker.store["spo2"];
    return (spo2 && parseInt(spo2) < 95) ? "needs_cylinder" : "covid_test_done";
  },

  "isCovidTestDone": async function (update, chat_tracker, global_store, bot_definition) {
    const srf_id = chat_tracker.store["srf_id"];
    return srf_id ? "covid_test_result" : "ct_scan_done";
  },
};

module.exports = functions;