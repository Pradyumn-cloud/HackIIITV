// background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openPopup") {
      console.log('Received openPopup message from:', sender.url);
      // Open the popup programmatically
      chrome.action.openPopup();
      sendResponse({ received: true });
  }
});