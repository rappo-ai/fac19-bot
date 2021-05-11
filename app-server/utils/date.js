module.exports = {
  formatDate: function (unixMs) {
    return new Date(unixMs).toLocaleString("en-GB",
      {
        timeZone: "Asia/Kolkata",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      }
    );
  }
};
