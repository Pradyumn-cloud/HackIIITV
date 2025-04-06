document.addEventListener('DOMContentLoaded', () => {
  // Handle close button click for hero section
  document.getElementById('heroCloseButton').addEventListener('click', () => {
      window.close(); // Closes the popup
  });

  // Handle minimize button click for hero section
  document.getElementById('heroMinimizeButton').addEventListener('click', () => {
      document.getElementById('heroSection').classList.remove('active');
  });

  // Handle chat button click to show chat container
  document.getElementById('chatButton').addEventListener('click', () => {
      document.getElementById('heroSection').classList.remove('active');
      document.getElementById('chatContainer').classList.add('active');
      document.getElementById('chatInputArea').style.display = 'flex';
      setTimeout(() => {
          document.getElementById('chatInput').focus();
      }, 300);
  });

  // Handle chat container minimize button
  document.getElementById('chatMinimizeButton').addEventListener('click', () => {
      const chatContainer = document.getElementById('chatContainer');
      const chatHeader = document.getElementById('chatHeader');
      const chatInputArea = document.getElementById('chatInputArea');
      const headerH1 = chatHeader.querySelector('h1');
      const headerH2 = chatHeader.querySelector('h2');

      chatContainer.classList.toggle('minimized');

      if (chatContainer.classList.contains('minimized')) {
          chatHeader.classList.remove('hidden');
          headerH2.style.opacity = '1';
          headerH1.style.display = 'none';
          chatInputArea.style.display = 'none';
          this.textContent = '+';
      } else {
          if (firstMessageSent) {
              chatHeader.classList.add('hidden');
          } else {
              headerH2.style.opacity = '1';
              headerH1.style.display = 'block';
          }
          chatInputArea.style.display = 'flex';
          this.textContent = '−';
      }
  });

  // Handle chat container close button
  document.getElementById('chatCloseButton').addEventListener('click', () => {
      window.close(); // Closes the popup
  });

  let firstMessageSent = false;
  let currentPageUrl = null;

  // Listen for URL from content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "PAGE_URL") {
          currentPageUrl = message.url;
          console.log('Received currentPageUrl from content script:', currentPageUrl); // Debug log
          sendResponse({ received: true });
      }
  });

  // Add a typing indicator to show processing
  function addTypingIndicator() {
      const messagesDiv = document.getElementById('chatMessages');
      const typingContainer = document.createElement('div');
      typingContainer.classList.add('message-container', 'bot');
      typingContainer.id = 'typingIndicator';
      
      const botMessage = document.createElement('div');
      botMessage.classList.add('message', 'bot', 'loader-container');
      
      const loaderElement = document.createElement('div');
      loaderElement.classList.add('loader');
      
      botMessage.appendChild(loaderElement);
      typingContainer.appendChild(botMessage);
      messagesDiv.appendChild(typingContainer);
      
      // Ensure scrolling to show the typing indicator
      setTimeout(() => {
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }, 10);
  }

  // Remove typing indicator
  function removeTypingIndicator() {
      const typingIndicator = document.getElementById('typingIndicator');
      if (typingIndicator) {
          typingIndicator.remove();
      }
  }

  // Add user message to chat
  function addUserMessage(message) {
      const messagesDiv = document.getElementById('chatMessages');
      const userMessageContainer = document.createElement('div');
      userMessageContainer.classList.add('message-container', 'user');
      
      const userMessage = document.createElement('div');
      userMessage.classList.add('message', 'user');
      userMessage.textContent = message;
      
      userMessageContainer.appendChild(userMessage);
      messagesDiv.appendChild(userMessageContainer);
      
      // Improved scrolling
      setTimeout(() => {
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }, 10);
  }

  // Add bot message to chat
  function addBotMessage(message) {
      const messagesDiv = document.getElementById('chatMessages');
      const botMessageContainer = document.createElement('div');
      botMessageContainer.classList.add('message-container', 'bot');
      
      const botMessage = document.createElement('div');
      botMessage.classList.add('message', 'bot');
      
      const formattedMessage = message
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
      
      botMessage.innerHTML = formattedMessage;
      
      botMessageContainer.appendChild(botMessage);
      messagesDiv.appendChild(botMessageContainer);
      
      // Improved scrolling
      setTimeout(() => {
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }, 10);
  }

  // Fetch data from backend
  async function fetchFromBackend(userInput, currentPageUrl) {
      try {
          addTypingIndicator();
          console.log('Fetching with userInput:', userInput, 'and currentPageUrl:', currentPageUrl); // Debug log
          const response = await fetch('http://localhost:3000/api/process', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({ userInput, currentPageUrl }),
          });

          if (!response.ok) {
              throw new Error('Backend request failed');
          }

          const data = await response.json();
          removeTypingIndicator();
          addBotMessage(data.formattedResponse);
      } catch (err) {
          console.error('Frontend Error:', err.message);
          removeTypingIndicator();
          addBotMessage("I'm sorry, I encountered an error while processing your request. Please try again.");
      }
  }

  // Handle sending messages
  document.getElementById('sendButton').addEventListener('click', async () => {
      const input = document.getElementById('chatInput');
      const message = input.value.trim();
      if (message) {
          if (!firstMessageSent) {
              document.getElementById('chatHeader').classList.add('hidden');
              firstMessageSent = true;
          }

          addUserMessage(message);
          input.value = '';

          // Use the received currentPageUrl or query tabs as fallback
          let urlToUse = currentPageUrl;
          if (!urlToUse) {
              console.log('No URL received from content script, querying tabs as fallback...');
              chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                  if (tabs.length > 0 && tabs[0].url && !tabs[0].url.startsWith('chrome-extension://')) {
                      urlToUse = tabs[0].url;
                  } else {
                      console.warn('No valid content tab found, using null');
                      urlToUse = null;
                  }
                  console.log('Fallback queried currentPageUrl:', urlToUse); // Debug log
                  fetchFromBackend(message, urlToUse);
              });
          } else {
              console.log('Using received currentPageUrl:', urlToUse);
              fetchFromBackend(message, urlToUse);
          }
      }
  });

  // Allow sending message with Enter key
  document.getElementById('chatInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
          document.getElementById('sendButton').click();
      }
  });

  // Inject content script to get the URL if not already received
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs[0]) {
          chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              files: ['content.js']
          }, () => {
              if (chrome.runtime.lastError) {
                  console.error('Error injecting content script:', chrome.runtime.lastError.message);
              }
          });
      }
  });
});