module.exports = {
  start_state: "welcome",
  default_fallback: "Please read the instructions and respond as asked.",
  command_fallback: "This is not a valid command",
  debug_channel_chat_id: process.env.TELEGRAM_DEBUG_CHANNEL_CHAT_ID,
  spreadsheet_headers: ["request_id", "creation_time", "last_update_time", "status", "srf_id", "forward_message", "name", "spo2", "mobile_number", "bu_number", "requirement", "bed_type", "needs_cylinder", "covid_test_result", "ct_scan_done", "ct_score", "age", "gender", "blood_group", "address", "alt_mobile_number", "hospital_preference", "admin_thread_message_id", "admin_thread_message_text", "active_chats"],
  commands: [
    {
      trigger: "/start",
      action: {
        type: "goto_state",
        state: "welcome",
      },
    },
    {
      trigger: "/restart",
      action: {
        type: "restart",
      },
    },
  ],
  states: [
    {
      name: "welcome",
      action: [
        {
          type: "send_message",
          text: "Hi! I am here to assist you with emergency Covid requests.",
        },
        {
          type: "goto_state",
          state: "request_type",
        },
      ],
      reset_slots: true,
    },
    {
      name: "request_type",
      action: [
        {
          type: "send_message",
          text: "Do you to forward a template message or create a new request? [[Forward Template, New Request]]",
        },
      ],
      fallback: "Please select one of the available options: [[Forward Template, New Request]]",
      transitions: [
        {
          on: "Forward Template",
          to: "forward_template",
        },
        {
          on: "New Request",
          to: "srf_id",
        },
      ],
      reset_slots: true,
    },
    {
      name: "forward_template",
      action: [
        {
          type: "send_message",
          text: "Please send us the request in the following format:\n\n1. Patient Name : \n2. Age : \n3. City : \n4. Symptoms : \n5. Since how many days : \n6. SPO2 Level : \n7. Is patient on Oxygen Cylinder ? : \n8. Searching Hospital Bed Since ? : \n9. List of Hospitals Visited : \n10. Covid Test Done ? : \n11. Covid Result (+ve/-ve/Awaiting) : \n12. Prefer Govt/Pvt/Any Hospital ? \n13. Attender name & Mobile No : \n14. Relation to the Patient : \n15. SRF ID : \n16. BU number : \n17. Bed type ?: \n18. Registered with 1912/108 :[[Cancel]]",
        },
      ],
      slots: {
        message_text: "forward_message",
      },
      transitions: [
        {
          on: "Cancel",
          to: "request_type",
        },
        {
          on: "*",
          to: "validate_forward_template",
        },
      ],
    },
    {
      name: "validate_forward_template",
      action: {
        type: "call_function",
        method: "validateForwardTemplate",
      },
    },
    {
      name: "forward_template_retry",
      transitions: [
        {
          on: "Cancel",
          to: "request_type",
        },
        {
          on: "*",
          to: "validate_forward_template",
        },
      ],
    },
    {
      name: "srf_id",
      action: {
        type: "send_message",
        text: "Please enter the 13-digit SRF ID of the Covid RTPCR test done. [[{cache.srf_id}][RTPCR test not done]]",
      },
      slots: {
        message_text: "srf_id",
      },
      validation: "^\\d{13}$|^RTPCR test not done$",
      fallback: "You need to enter the 13-digit SRF ID or click one of the options below: [[{cache.srf_id}][RTPCR test not done]]",
      transitions: [
        {
          on: "*",
          to: "check_duplicate_srf_id",
        },
      ],
    },
    {
      name: "check_duplicate_srf_id",
      action: {
        type: "call_function",
        method: "checkDuplicateSrfId",
      },
    },
    {
      name: "check_duplicate_forward_srf_id",
      action: {
        type: "call_function",
        method: "checkDuplicateForwardSrfId",
      },
    },
    {
      name: "confirm_duplicate_update",
      action: {
        type: "call_function",
        method: "confirmDuplicateUpdate"
      },
    },
    {
      name: "confirm_duplicate_update_wait",
      validation: "^Yes$|^No$",
      fallback: "Please confirm with a Yes / No. [[Yes, No]]",
      transitions: [
        {
          on: "Yes",
          to: "update_duplicate",
        },
        {
          on: "No",
          to: "sleep",
        },
      ]
    },
    {
      name: "update_duplicate",
      action: {
        type: "call_function",
        method: "updateDuplicate",
      },
    },
    {
      name: "requirement",
      action: {
        type: "send_message",
        text: "Please select the category for which you want assistance: [[Oxygen][Beds]]",
      },
      slots: {
        message_text: "requirement",
      },
      validation: "^Oxygen$|^Beds$",
      fallback: "Please select the category from one of the available options: [[Oxygen][Beds]]",
      transitions: [
        {
          on: "Oxygen",
          to: "spo2",
        },
        {
          on: "Beds",
          to: "bed_type",
        },
      ],
    },
    {
      name: "bed_type",
      action: {
        type: "send_message",
        text: "What type of bed do you need? [[General][Bed with Oxygen][HDU][ICU][CICU][ICU with Ventilator]]",
      },
      slots: {
        message_text: "bed_type",
      },
      validation: "^General$|^Bed with Oxygen$|^HDU$|^ICU$|^CICU$|^ICU with Ventilator$",
      fallback: "Please select from one of the bed types: [[General][Bed with Oxygen][HDU][ICU][CICU][ICU with Ventilator]]",
      transitions: [
        {
          on: "*",
          to: "spo2",
        },
      ],
    },
    {
      name: "spo2",
      action: {
        type: "send_message",
        text: "What is the current SPO2 level of the patient? Please enter a value between 1 and 100.",
      },
      slots: {
        message_text: "spo2",
      },
      validation: "^[1-9][0-9]?$|^100$",
      fallback: "Please enter a value between 1 and 100.",
      transitions: [
        {
          on: "*",
          to: "check_spo2",
        },
      ],
    },
    {
      name: "check_spo2",
      action: {
        type: "call_function",
        method: "checkSpo2",
      },
    },
    {
      name: "needs_cylinder",
      action: {
        type: "send_message",
        text: "Does the patient require an oxygen cylinder? [[Yes, No]]",
      },
      validation: "^Yes$|^No$",
      fallback: "Please confirm with a Yes / No. [[Yes, No]]",
      slots: {
        message_text: "needs_cylinder",
      },
      transitions: [
        {
          on: "*",
          to: "covid_test_done",
        },
      ],
    },
    {
      name: "covid_test_done",
      action: {
        type: "call_function",
        method: "isCovidTestDone",
      },
    },
    {
      name: "covid_test_result",
      action: {
        type: "send_message",
        text: "What is the COVID test result? [[Positive, Negative, Awaiting]]",
      },
      slots: {
        message_text: "covid_test_result",
      },
      validation: "^Positive$|^Negative$|^Awaiting$",
      fallback: "Please select one of the following options: [[Positive, Negative, Awaiting]]",
      transitions: [
        {
          on: "Positive",
          to: "bu_number",
        },
        {
          on: "Negative",
          to: "ct_scan_done",
        },
        {
          on: "*",
          to: "collect_personal_details",
        },
      ],
    },
    {
      name: "ct_scan_done",
      action: {
        type: "send_message",
        text: "Has the patient taken a CT scan? [[Yes, No]]",
      },
      slots: {
        message_text: "ct_scan_done",
      },
      fallback: "Please confirm with a Yes / No. [[Yes, No]]",
      transitions: [
        {
          on: "Yes",
          to: "ct_score",
        },
        {
          on: "No",
          to: "ct_block_next",
        },
      ],
    },
    {
      name: "ct_score",
      action: {
        type: "send_message",
        text: "What is the CT score? Please enter a number between 1 and 25.",
      },
      slots: {
        message_text: "ct_score",
      },
      validation: "^[1-9]$|^1[0-9]$|^2[0-5]$",
      fallback: "Please enter a number between 1 and 25.",
      transitions: [
        {
          on: "*",
          to: "ct_block_next",
        },
      ],
    },
    {
      name: "ct_block_next",
      action: {
        type: "call_function",
        method: "ctBlockNextState"
      },
    },
    {
      name: "bu_number",
      action: {
        type: "send_message",
        text: "What is the 6-digit BU number? [[{cache.bu_number}][Not yet assigned]]",
      },
      slots: {
        message_text: "bu_number",
      },
      validation: "^\\d{6}$|^Not yet assigned$",
      persist_slot: true,
      fallback: "Please enter the 6-digit BU number: [[{cache.bu_number}][Not yet assigned]]",
      transitions: [
        {
          on: "*",
          to: "collect_personal_details",
        },
      ],
    },
    {
      name: "collect_personal_details",
      action: [
        {
          type: "send_message",
          text: "We will need to collect some personal details to proceed.",
        },
        {
          type: "goto_state",
          state: "name",
        },
      ]
    },
    {
      name: "name",
      action: {
        type: "send_message",
        text: "What is the full name of the patient? [[{cache.name}]]",
      },
      slots: {
        message_text: "name",
      },
      transitions: [
        {
          on: "*",
          to: "age",
        },
      ],
    },
    {
      name: "age",
      action: {
        type: "send_message",
        text: "What is the age of the patient? [[{cache.age}]]",
      },
      slots: {
        message_text: "age",
      },
      validation: "^[1-9][0-9]?$|^1[0-1]\\d$|^120$",
      fallback: "Please enter a number between 1 and 120. [[{cache.age}]]",
      transitions: [
        {
          on: "*",
          to: "gender",
        },
      ],
    },
    {
      name: "gender",
      action: {
        type: "send_message",
        text: "What is the gender of the patient?\n{gender} [[Male, Female]]",
      },
      slots: {
        message_text: "gender",
      },
      validation: "^Male$|^Female$",
      fallback: "Please select one of the below options. [[Male, Female]]",
      transitions: [
        {
          on: "*",
          to: "blood_group",
        },
      ],
    },
    {
      name: "blood_group",
      action: {
        type: "send_message",
        text: "What is the blood group of the patient? [[A+, A-][B+, B-][O+, O-][AB+, AB-][Don't know]]",
      },
      slots: {
        message_text: "blood_group",
      },
      validation: "^A\\+$|^A-$|^B\\+$|^B-$|^O\\+$|^O-$|^AB\\+$|^AB-$|^Don't know$",
      fallback: "Please select one of the below options: [[A+, A-][B+, B-][O+, O-][AB+, AB-][Don't know]]",
      transitions: [
        {
          on: "*",
          to: "mobile_number",
        },
      ],
    },
    {
      name: "mobile_number",
      action: {
        type: "send_message",
        text: "What is the 10-digit mobile number of the patient (or the attender)? [[{cache.mobile_number}]]",
      },
      slots: {
        message_text: "mobile_number",
      },
      validation: "^\\d{10}$",
      fallback: "Please enter a 10-digit mobile number. [[{cache.mobile_number}]]",
      transitions: [
        {
          on: "*",
          to: "alt_mobile_number",
        },
      ],
    },
    {
      name: "alt_mobile_number",
      action: {
        type: "send_message",
        text: "Please share an alternate mobile number if you have one. [[{cache.alt_mobile_number}, Skip]]",
      },
      slots: {
        message_text: "alt_mobile_number",
      },
      validation: "^\\d{10}$|^Skip$",
      fallback: "Please enter a 10-digit mobile number. [[{cache.alt_mobile_number}, Skip]]",
      transitions: [
        {
          on: "*",
          to: "address",
        },
      ],
    },
    {
      name: "address",
      action: {
        type: "send_message",
        text: "What is the address of the patient? [[{cache.address}]]",
      },
      slots: {
        message_text: "address",
      },
      transitions: [
        {
          on: "*",
          to: "hospital_preference",
        },
      ],
    },
    {
      name: "hospital_preference",
      action: {
        type: "send_message",
        text: "What is the hospital preference of the patient? [[Private][Government][No preference]]",
      },
      slots: {
        message_text: "hospital_preference",
      },
      validation: "^Private$|^Government$|^No preference$",
      fallback: "Please select the hospital preference from the available options: [[Private][Government][No preference]]",
      transitions: [
        {
          on: "*",
          to: "summary",
        },
      ],
    },
    {
      name: "summary",
      action: [
        {
          type: "send_message",
          text: "Summary of your request:\n\nRequirement: {requirement}\nSPO2 level: {spo2}\nBed type: {bed_type}\nNeeds cylinder: {needs_cylinder}\nCovid test result: {covid_test_result}\nCT Scan done?: {ct_scan_done}\nCT Score: {ct_score}\nBU number: {bu_number}\nSRF ID: {srf_id}\nName: {name}\nAge: {age}\nGender: {gender}\nBlood group: {blood_group}\nMobile number: {mobile_number}\nAlt mobile number: {alt_mobile_number}\nAddress: {address}\nHospital preference: {hospital_preference}",
          default_slot_value: "N/A",
        },
        {
          type: "send_message",
          text: "Is this correct? [[Yes][No]]"
        },
      ],
      fallback: "Please confirm with a Yes / No. [[Yes][No]]",
      transitions: [
        {
          on: "Yes",
          to: "submit_form",
        },
        {
          on: "No",
          to: "request_type",
        },
      ],
    },
    {
      name: "forward_summary",
      action: [
        {
          type: "send_message",
          text: "Summary of your request:\n\n{forward_message}",
        },
        {
          type: "send_message",
          text: "Is this correct? [[Yes][No]]"
        },
      ],
      fallback: "Please confirm with a Yes / No. [[Yes][No]]",
      transitions: [
        {
          on: "Yes",
          to: "submit_form",
        },
        {
          on: "No",
          to: "request_type",
        },
      ],
    },
    {
      name: "submit_form",
      action: [
        {
          type: "call_function",
          method: "submitForm",
          on_success: "sleep",
          on_failure: "submit_form_failure",
        },
      ],
    },
    {
      name: "submit_form_failure",
      action: [
        {
          type: "send_message",
          text: "Your request could not be recorded at this time. Please try again after some time.",
        },
        {
          type: "goto_state",
          state: "request_type",
        },
      ],
    },
    {
      name: "sleep",
      transitions: [
        {
          on: "*",
          to: "request_type",
        },
      ],
    }
  ],
  group: {
    allow: process.env.TELEGRAM_ADMIN_GROUP_CHAT_ID,
    reply_to_bot: {
      action: {
        type: "call_function",
        method: "appendAdminForm"
      },
    },
    callback_query: {
      action: {
        type: "call_function",
        method: "handleAdminCallback"
      },
    }
  }
};