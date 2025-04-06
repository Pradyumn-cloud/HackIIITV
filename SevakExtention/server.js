const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(cors()); // Enable CORS to allow frontend requests

// API Keys
const tavilyKey = "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";
const togetherKey = "f7aefe2e695efef32ef0a2fa5ccdb0dd15f8b70a982605c9d439a0a3f2eecfe4";

// Custom LangChain helper class implementation
class LangChainHelper {
  constructor() {
    this.prompts = {};
    this.usage = {};
  }
  
  registerPrompt(name, promptObj) {
    this.prompts[name] = promptObj;
  }
  
  trackCompletion(promptName, usageData) {
    this.usage[promptName] = usageData;
  }
  
  async getUsageStats() {
    return this.usage;
  }
}

const langchain = new LangChainHelper();

// Helper function to add delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Tavily Search Function with retry logic
async function searchTavily(query, maxRetries = 3) {
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      console.log(`Attempting Tavily search (attempt ${retries + 1}/${maxRetries + 1}) with query: ${query}`);
      const response = await axios.post(
        "https://api.tavily.com/search",
        {
          query,
          include_answer: true,
          include_raw_content: true,
          search_depth: "advanced",
          max_results: 10,
        },
        {
          headers: {
            Authorization: `Bearer ${tavilyKey}`,
            "Content-Type": "application/json",
          },
        }
      );
  
      return {
        answer: response.data.answer || "No direct answer found.",
        rawContent: response.data.results || [],
      };
    } catch (err) {
      if (err.response && err.response.status === 429 && retries < maxRetries) {
        const waitTime = Math.pow(2, retries) * 1000 + Math.random() * 1000;
        console.log(`Rate limit hit. Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
        retries++;
      } else {
        throw new Error(`Tavily API error: ${err.message}`);
      }
    }
  }
}

// Website analysis function to generate 1-line intro
async function getWebsiteIntro(websiteUrl, maxRetries = 3) {
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      console.log(`Analyzing website (attempt ${retries + 1}/${maxRetries + 1}): ${websiteUrl}`);
      const systemPrompt = "You are a helpful assistant that provides brief website descriptions.";
      const userPrompt = `Generate a single breif line on the website: ${websiteUrl}`;
      
      const response = await axios.post(
        "https://api.together.xyz/v1/chat/completions",
        {
          model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 100,
        },
        {
          headers: {
            Authorization: `Bearer ${togetherKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      
      return response.data.choices[0].message.content.trim();
    } catch (err) {
      if (err.response && err.response.status === 429 && retries < maxRetries) {
        const waitTime = Math.pow(2, retries) * 1000 + Math.random() * 1000;
        console.log(`Rate limit hit. Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
        retries++;
      } else {
        return `Could not analyze website: ${err.message}`;
      }
    }
  }
}

// Chat function with Together AI for website context
async function processChatWithTogetherAI(userMessage, websiteContext, chatHistory = [], maxRetries = 3) {
  const systemPrompt = `You are a helpful assistant that specializes EXCLUSIVELY in providing information about in one single line only ${websiteContext.websiteUrl}. This is a ${websiteContext.isGovernment ? 'government' : 'non-government'} website. You MUST focus only on this website and avoid referencing other websites (e.g., passportindia.gov.in) unless explicitly asked. When users ask for specific tasks or processes, refer them to ask for a task extraction. Otherwise, respond conversationally based solely on ${websiteContext.websiteUrl}.`;
  
  const messages = [
    { role: "system", content: systemPrompt },
    ...chatHistory,
    { role: "user", content: userMessage }
  ];
  
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      console.log(`Processing chat (attempt ${retries + 1}/${maxRetries + 1}) for ${websiteContext.websiteUrl} with message: ${userMessage}`);
      const response = await axios.post(
        "https://api.together.xyz/v1/chat/completions",
        {
          model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
          messages: messages,
          temperature: 0.7,
          max_tokens: 800,
        },
        {
          headers: {
            Authorization: `Bearer ${togetherKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      
      return response.data.choices[0].message.content.trim();
    } catch (err) {
      if (err.response && err.response.status === 429 && retries < maxRetries) {
        const waitTime = Math.pow(2, retries) * 1000 + Math.random() * 1000;
        console.log(`Rate limit hit for chat. Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
        retries++;
      } else {
        throw new Error(`Together AI chat error: ${err.message}`);
      }
    }
  }
}

// LangChain Together AI Processing Function
async function processWithTogetherAI(rawText, taskType = "extract_documents", maxRetries = 3) {
  const systemPrompt = "You are a precise, detail-oriented assistant.";
  
  const prompts = {
    extract_documents: `Extract a clear list of individual required documents from this text. Return only bullet points:\n\n${rawText}`,
    extract_steps: `Extract a detailed step-by-step procedure from this text. Return numbered steps:\n\n${rawText}`,
    summarize: `Summarize this text into a concise paragraph:\n\n${rawText}`,
    extract_timeline: `Based on the information provided, estimate the number of days it typically takes to complete this task from start to finish. Consider processing times, waiting periods, and any potential delays. Return only a number or range of numbers representing days:\n\n${rawText}`,
    extract_price: `Based on the information provided, extract all fees, charges, and prices related to completing this task. Include application fees, processing charges, and any other costs. Return a detailed breakdown of all costs in INR (₹):\n\n${rawText}`
  };

  const prompt = prompts[taskType] || prompts.extract_documents;
  
  langchain.registerPrompt(taskType, { system: systemPrompt, user: prompt });

  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      console.log(`Processing ${taskType} (attempt ${retries + 1}/${maxRetries + 1})...`);
      const response = await axios.post(
        "https://api.together.xyz/v1/chat/completions",
        {
          model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 1500,
        },
        {
          headers: {
            Authorization: `Bearer ${togetherKey}`,
            "Content-Type": "application/json",
          },
        }
      );
  
      if (response.data.usage) {
        langchain.trackCompletion(taskType, response.data.usage);
      }
      
      return response.data.choices[0].message.content.trim();
    } catch (err) {
      if (err.response && err.response.status === 429 && retries < maxRetries) {
        const waitTime = Math.pow(2, retries) * 1000 + Math.random() * 1000;
        console.log(`Rate limit hit for ${taskType}. Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
        retries++;
      } else {
        throw new Error(`Together AI error: ${err.message}`);
      }
    }
  }
}

// Serialize API calls
async function processSequentially(rawText) {
  console.log("Processing with Together AI (sequential mode to avoid rate limits)...");
  
  const summary = await processWithTogetherAI(rawText, "summarize");
  await delay(1500);
  
  const documents = await processWithTogetherAI(rawText, "extract_documents");
  await delay(1500);
  
  const steps = await processWithTogetherAI(rawText, "extract_steps");
  await delay(1500);
  
  const timeline = await processWithTogetherAI(rawText, "extract_timeline");
  await delay(1500);
  
  const price = await processWithTogetherAI(rawText, "extract_price");
  
  return { summary, documents, steps, timeline, price };
}

// Check if a URL is likely a government website
function isGovernmentWebsite(url) {
  const govPatterns = [
    /\.gov($|\/|\.)/i,
    /\.nic\.in($|\/)/i,
    /\.gov\.in($|\/)/i,
    /\.gob\.($|\/)/i,
    /\.gc\.ca($|\/)/i,
    /\.gouv\.($|\/)/i,
    /\.mil($|\/)/i
  ];
  
  return govPatterns.some(pattern => pattern.test(url));
}

// Check if the input is a task extraction request
function isTaskExtractionRequest(input) {
  const extractionPatterns = [
    /extract task/i,
    /extract information/i,
    /extract data/i,
    /extract details/i,
    /get information (about|on|for)/i,
    /get data (about|on|for)/i,
    /how (to|do I) (apply|get|register|submit|obtain|download|fill|complete)/i,
    /steps (to|for)/i,
    /process (to|for)/i,
    /procedure (to|for)/i
  ];
  
  return extractionPatterns.some(pattern => pattern.test(input));
}

// Improved URL extraction function
function extractWebsiteUrl(userInput, currentPageUrl = null) {
  // More comprehensive regex to match URLs
  const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(?:gov|org|in|com|edu|net)(?:\.[a-zA-Z]{2})?(?:\/[^\s]*)?)/i;
  const match = userInput.match(urlPattern);
  
  let detectedUrl = match ? match[0] : null;
  
  // Fallback to current page URL if provided and no URL is in input
  if (!detectedUrl && currentPageUrl) {
    const pageUrlMatch = currentPageUrl.match(urlPattern);
    detectedUrl = pageUrlMatch ? pageUrlMatch[0] : null;
  }
  
  // Log for debugging
  console.log(`User Input: "${userInput}"`);
  console.log(`Current Page URL (if provided): ${currentPageUrl || 'None'}`);
  console.log(`Detected URL: ${detectedUrl || 'None'}`);
  
  // If no URL is detected, default to passportindia.gov.in
  if (!detectedUrl) {
    console.log("No URL detected, defaulting to passportindia.gov.in");
    return "https://passportindia.gov.in";
  }
  
  // Ensure the URL has a proper protocol if missing
  if (!detectedUrl.startsWith("http://") && !detectedUrl.startsWith("https://")) {
    detectedUrl = "https://" + detectedUrl;
  }
  
  console.log(`Final URL: ${detectedUrl}`);
  return detectedUrl;
}

// Main Pipeline Function
async function runAdvancedPipeline(userInput, chatHistory = [], currentPageUrl = null) {
  try {
    const websiteUrl = extractWebsiteUrl(userInput, currentPageUrl);
    const websiteIntro = await getWebsiteIntro(websiteUrl);
    const isGovernment = isGovernmentWebsite(websiteUrl);
    const websiteContext = { websiteUrl, websiteIntro, isGovernment };

    // Reset chat history if the URL changes to avoid context carryover
    const previousUrl = chatHistory.length > 0 ? chatHistory[0].websiteUrl : null;
    if (previousUrl !== websiteUrl) {
      console.log(`URL changed from ${previousUrl} to ${websiteUrl}. Resetting chat history.`);
      chatHistory = []; // Reset history when URL changes
    }

    // Check if this is a task extraction request
    if (isTaskExtractionRequest(userInput)) {
      const task = userInput.replace(/extract (task|information|data|details)/i, '').trim().replace(/on\s+.*/, '').trim();
      console.log(`Starting pipeline for task: "${task}" on website: ${websiteUrl}`);
      
      const query = `Provide a comprehensive guide to ${task} on ${websiteUrl}. Include all required documents, detailed steps, tips, potential challenges, timeline, and all fees or charges in INR. Be as thorough as possible.`;
      const tavilyData = await searchTavily(query);

      const rawText = `${tavilyData.answer}\n\nRaw Results:\n${tavilyData.rawContent
        .map((r) => `${r.title}: ${r.content}`)
        .join("\n")}`;

      const { summary, documents, steps, timeline, price } = await processSequentially(rawText);

      const results = {
        task,
        websiteUrl,
        timestamp: new Date().toISOString(),
        summary,
        requiredDocuments: documents,
        detailedSteps: steps,
        estimatedDays: timeline,
        priceBreakdown: price
      };
      
      const formattedResponse = formatChatResponse(results);
      chatHistory.push({ role: "user", content: userInput }, { role: "assistant", content: formattedResponse });
      return { formattedResponse, chatHistory };
    } else {
      // Handle as a chat query
      const chatResponse = await processChatWithTogetherAI(userInput, websiteContext, chatHistory);
      chatHistory.push({ role: "user", content: userInput }, { role: "assistant", content: chatResponse });
      return { formattedResponse: chatResponse, chatHistory };
    }
  } catch (err) {
    console.error("Pipeline Error:", err.message);
    const errorResponse = "I'm sorry, I encountered an error while processing your request. Please try again with a more specific question about a government service.";
    chatHistory.push({ role: "user", content: userInput }, { role: "assistant", content: errorResponse });
    return { formattedResponse: errorResponse, chatHistory };
  }
}

// Format results for chat display
function formatChatResponse(results) {
  let response = `📝 **Summary**: ${results.summary}\n\n`;
  response += `📋 **Required Documents**:\n${results.requiredDocuments}\n\n`;
  response += `🔄 **Process Steps**:\n${results.detailedSteps}\n\n`;
  response += `⏱️ **Estimated Timeline**: ${results.estimatedDays} days\n\n`;
  response += `💰 **Costs and Fees**:\n${results.priceBreakdown}`;
  return response;
}

// Maintain chat history globally (for simplicity; consider a session-based approach for production)
let globalChatHistory = [];

// API Endpoint
app.post('/api/process', async (req, res) => {
  const { userInput, currentPageUrl } = req.body;
  console.log("Received request body:", req.body);
  if (!userInput) {
    return res.status(400).json({ error: 'User input is required' });
  }

  const { formattedResponse, chatHistory } = await runAdvancedPipeline(userInput, globalChatHistory, currentPageUrl);
  globalChatHistory = chatHistory; // Update global chat history
  res.json({ formattedResponse });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});