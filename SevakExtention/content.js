// content.js
(function() {
  // Log to verify the script is running
  console.log('Content script running on:', window.location.href);

  // Check for .gov.in domain and send messages
  if (window.location.hostname.endsWith('.gov.in')) {
      // Send message to open the popup
      chrome.runtime.sendMessage({ action: "openPopup" }, (response) => {
          if (chrome.runtime.lastError) {
              console.error('Error sending openPopup message:', chrome.runtime.lastError.message);
          } else if (response && response.received) {
              console.log('openPopup message sent successfully from:', window.location.href);
          }
      });

      // Send the current page URL for context
      chrome.runtime.sendMessage({ type: "PAGE_URL", url: window.location.href }, (response) => {
          if (chrome.runtime.lastError) {
              console.error('Error sending PAGE_URL message:', chrome.runtime.lastError.message);
          } else if (response && response.received) {
              console.log('PAGE_URL message sent successfully:', window.location.href);
          }
      });
  }
})();