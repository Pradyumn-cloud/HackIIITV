const axios = require("axios");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

// API Keys
const tavilyKey = "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";
const togetherKey = "f7aefe2e695efef32ef0a2fa5ccdb0dd15f8b70a982605c9d439a0a3f2eecfe4";

// Create interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

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
  
  // Additional methods for future LangChain integration
  async getUsageStats() {
    return this.usage;
  }
}

// Create a singleton instance
const langchain = new LangChainHelper();

// Helper function to add delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Tavily Search Function with retry logic
async function searchTavily(query, maxRetries = 3) {
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      console.log(`Attempting Tavily search (attempt ${retries + 1}/${maxRetries + 1})...`);
      
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
        // Rate limit hit, retry with exponential backoff
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

// Website analysis function to generate 1-line intro with retry logic
async function getWebsiteIntro(websiteUrl, maxRetries = 3) {
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      console.log(`Analyzing website (attempt ${retries + 1}/${maxRetries + 1})...`);
      
      const systemPrompt = "You are a helpful assistant that provides brief website descriptions.";
      const userPrompt = `Generate a single-sentence introduction that explains what this website is for: ${websiteUrl}`;
      
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
        // Rate limit hit, retry with exponential backoff
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

// Chat function with Together AI specifically for website context
async function processChatWithTogetherAI(userMessage, websiteContext, chatHistory = [], maxRetries = 3) {
  const systemPrompt = `You are a helpful assistant that specializes in providing information about ${websiteContext.websiteUrl}. This appears to be a ${websiteContext.isGovernment ? 'government' : 'non-government'} website. When users ask for specific tasks or processes, refer them to ask for a task extraction. Otherwise, respond conversationally.`;
  
  // Create the messages array with chat history and the new user message
  const messages = [
    { role: "system", content: systemPrompt },
    ...chatHistory,
    { role: "user", content: userMessage }
  ];
  
  let retries = 0;
  
  while (retries <= maxRetries) {
    try {
      console.log(`Processing chat (attempt ${retries + 1}/${maxRetries + 1})...`);
      
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
        // Rate limit hit, retry with exponential backoff
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

// LangChain Together AI Processing Function with retry logic
async function processWithTogetherAI(rawText, taskType = "extract_documents", maxRetries = 3) {
  // Create prompt templates
  const systemPrompt = "You are a precise, detail-oriented assistant.";
  
  const prompts = {
    extract_documents: `Extract a clear list of individual required documents from this text. Return only bullet points:\n\n${rawText}`,
    extract_steps: `Extract a detailed step-by-step procedure from this text. Return numbered steps:\n\n${rawText}`,
    summarize: `Summarize this text into a concise paragraph:\n\n${rawText}`,
    extract_timeline: `Based on the information provided, estimate the number of days it typically takes to complete this task from start to finish. Consider processing times, waiting periods, and any potential delays. Return only a number or range of numbers representing days:\n\n${rawText}`,
    extract_price: `Based on the information provided, extract all fees, charges, and prices related to completing this task. Include application fees, processing charges, and any other costs. Return a detailed breakdown of all costs in INR (₹):\n\n${rawText}`
  };

  const prompt = prompts[taskType] || prompts.extract_documents;
  
  // Register the prompt with LangChain for future use
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

      // Log LangChain usage if available
      if (response.data.usage) {
        langchain.trackCompletion(taskType, response.data.usage);
      }
      
      return response.data.choices[0].message.content.trim();
    } catch (err) {
      if (err.response && err.response.status === 429 && retries < maxRetries) {
        // Rate limit hit, retry with exponential backoff
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

// Function to sanitize filename
function sanitizeFilename(input) {
  return input.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Function to save results as JSON
function saveResultsToJson(data, websiteUrl, task) {
  try {
    // Create a sanitized filename
    const sanitizedTask = sanitizeFilename(task);
    const sanitizedUrl = sanitizeFilename(websiteUrl.replace(/^https?:\/\//, '').split('/')[0]);
    const filename = `${sanitizedTask}_${sanitizedUrl}_${Date.now()}.json`;
    
    // Ensure the directory exists
    const dir = './results';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    
    // Write the file
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    
    return { success: true, filepath };
  } catch (err) {
    console.error("Error saving JSON:", err.message);
    return { success: false, error: err.message };
  }
}

// Serialize API calls instead of running in parallel
async function processSequentially(rawText) {
  console.log("Processing with Together AI (sequential mode to avoid rate limits)...");
  
  // Process each extraction with delay between calls
  const summary = await processWithTogetherAI(rawText, "summarize");
  await delay(1500); // Wait 1.5 seconds between calls
  
  const documents = await processWithTogetherAI(rawText, "extract_documents");
  await delay(1500);
  
  const steps = await processWithTogetherAI(rawText, "extract_steps");
  await delay(1500);
  
  const timeline = await processWithTogetherAI(rawText, "extract_timeline");
  await delay(1500);
  
  const price = await processWithTogetherAI(rawText, "extract_price");
  
  return { summary, documents, steps, timeline, price };
}

// Main Pipeline Function
async function runAdvancedPipeline(websiteUrl, task) {
  console.log(`\nStarting pipeline for task: "${task}" on website: ${websiteUrl}`);
  try {
    console.log("Fetching detailed info from Tavily...");
    const query = `Provide a comprehensive guide to ${task} on ${websiteUrl}. Include all required documents, detailed steps, tips, potential challenges, timeline, and all fees or charges. Be as thorough as possible.`;
    const tavilyData = await searchTavily(query);

    const rawText = `${tavilyData.answer}\n\nRaw Results:\n${tavilyData.rawContent
      .map((r) => `${r.title}: ${r.content}`)
      .join("\n")}`;
            
    // Process sequentially instead of in parallel to avoid rate limits
    const { summary, documents, steps, timeline, price } = await processSequentially(rawText);

    // Prepare results object
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
    
    // Save results to JSON file
    const jsonResult = saveResultsToJson(results, websiteUrl, task);
    
    console.log("\n=== RESULTS ===");
    console.log("\nSummary:");
    console.log(summary);
    console.log("\nRequired Documents:");
    console.log(documents);
    console.log("\nDetailed Steps:");
    console.log(steps);
    console.log("\nEstimated Timeline (Days):");
    console.log(timeline);
    console.log("\nPrice Information:");
    console.log(price);
    
    if (jsonResult.success) {
      console.log(`\nResults saved to: ${jsonResult.filepath}`);
    } else {
      console.log(`\nFailed to save results: ${jsonResult.error}`);
    }
    
    return results;
  } catch (err) {
    console.error("Pipeline Error:", err.message);
    return null;
  }
}

// Check if a URL is likely a government website
function isGovernmentWebsite(url) {
  // Check for common government website indicators
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

// Function to check if the input is a task extraction request
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

// New implementation for website-specific chat with original data extraction
async function startWebsiteSpecificInterface() {
  console.log("=== Website-Specific Assistant ===");
  
  rl.question("\nEnter the website URL you want to work with: ", async (websiteUrl) => {
    try {
      // Analyze the website and create the context
      console.log("\nAnalyzing website...");
      const websiteIntro = await getWebsiteIntro(websiteUrl);
      const isGovernment = isGovernmentWebsite(websiteUrl);
      
      // Create the website context
      const websiteContext = {
        websiteUrl,
        websiteIntro,
        isGovernment
      };
      
      console.log(`\nWebsite Introduction: ${websiteIntro}`);
      console.log(`Website Type: ${isGovernment ? 'Government' : 'Non-Government'}`);
      console.log("\nYou can now chat about this website or ask to extract information for specific tasks.");
      console.log("For data extraction, say something like 'Extract information about how to apply for a passport'");
      
      // Initialize chat history
      let chatHistory = [];
      
      // Start the conversation loop for this specific website
      await websiteConversationLoop(websiteContext, chatHistory);
    } catch (error) {
      console.error("Error:", error.message);
      rl.close();
    }
  });
}

// Website-specific conversation loop
async function websiteConversationLoop(websiteContext, chatHistory) {
  rl.question("\nYou: ", async (userInput) => {
    // Check for exit command
    if (userInput.toLowerCase() === 'exit') {
      console.log("\nThank you for using the Website-Specific Assistant!");
      rl.close();
      return;
    }
    
    try {
      // Check if this is a task extraction request
      if (isTaskExtractionRequest(userInput)) {
        console.log("\nDetected task extraction request");
        
        // Extract the task from the user input
        const task = userInput.replace(/extract (task|information|data|details)/i, '').trim();
        
        // Only proceed with extraction if website is government (or modify as needed)
        if (websiteContext.isGovernment || !websiteContext.isGovernment) { // Change this condition as needed
          console.log(`\nProcessing task extraction: ${task}`);
          
          // Run the original data extraction pipeline
          await runAdvancedPipeline(websiteContext.websiteUrl, task);
          
          // Add this exchange to chat history
          chatHistory.push({ role: "user", content: userInput });
          chatHistory.push({ 
            role: "assistant", 
            content: `I've analyzed the task "${task}" on ${websiteContext.websiteUrl}. The results are displayed above.` 
          });
        } else {
          console.log("\nThis is not a government website. Data extraction is only available for government websites.");
          const response = "I'm sorry, but data extraction is only available for government websites. I can still answer general questions about this website.";
          console.log(`\nAssistant: ${response}`);
          
          // Add to chat history
          chatHistory.push({ role: "user", content: userInput });
          chatHistory.push({ role: "assistant", content: response });
        }
      } else {
        // Process as normal chat about the website
        console.log("\nProcessing as normal chat...");
        const response = await processChatWithTogetherAI(userInput, websiteContext, chatHistory);
        console.log(`\nAssistant: ${response}`);
        
        // Add to chat history
        chatHistory.push({ role: "user", content: userInput });
        chatHistory.push({ role: "assistant", content: response });
        
        // Limit chat history length to prevent token issues
        if (chatHistory.length > 10) {
          chatHistory = chatHistory.slice(-10);
        }
      }
    } catch (error) {
      console.error("Error:", error.message);
    }
    
    // Continue the conversation loop
    websiteConversationLoop(websiteContext, chatHistory);
  });
}

// Start the application with website-specific interface
function main() {
  startWebsiteSpecificInterface();
}

main();