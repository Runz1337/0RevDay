import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // AI Logic Route
  app.post("/api/analyze-notes", async (req, res) => {
    try {
      console.log("Analyzing notes...");
      const { syllabusContext, dailyInput, difficulty, timeTaken, base64Images } = req.body;
      const apiKey = req.body.customAiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set.");
      }
      console.log(`Received ${base64Images ? base64Images.length : 0} images, dailyInput length: ${dailyInput ? dailyInput.length : 0}`);

      const config: any = { apiKey };
      if (req.body.customAiUrl) {
         config.httpOptions = { baseUrl: req.body.customAiUrl };
      }
      
      const ai = new GoogleGenAI(config);
      const modelId = req.body.customAiModel || 'gemini-2.5-flash';
      // The user wants output as strict JSON with specific fields
      const prompt = `
You are the Core Logic Engine and Vision Analyzer for a Medical Revision App. Your goal is to analyze a user's daily study input and an image of their handwritten notes/diagrams to schedule optimal revision windows.

Inputs Provided in Request:
1. Image(s): (Provided alongside this text if available)
2. Text Log - Daily Input: ${dailyInput || "None provided"}
3. Text Log - Self-Rated Difficulty: ${difficulty || "Not specified"}
4. Text Log - Time Taken: ${timeTaken || "Not specified"}
5. Syllabus Context: ${syllabusContext || "Not specified"}

Analysis Requirements:
* Content Extraction: Identify the primary medical topics in the image (e.g., specific biochemical pathways like homopolysaccharide structures, or physiological concepts like nerve-muscle activity). Also incorporate the text log context.
* Density & Complexity Scoring: Analyze the visual density of the notes. A page packed with complex flowcharts or dense text should receive a higher "Volume/Hardness" score than a simple bulleted list. Output this as "visual_density_score" (1-10) in metadata.
* Fatigue Detection: Compare the visual volume to the self-reported time. If the user spent a lot of time on a sparsely written page, infer high cognitive friction and express this via the DLBS variables (e.g., lower bandwidth weight to prevent burnout). 
* Auto-Tagging: Perform OCR and semantic scanning to automatically assign the correct 'category' and identify high-yield topics without relying on user text alone.

Output Format: A SINGLE JSON object (NOT an array). It must strictly match this schema:
{
  "title": "String - Overall title of the study session",
  "description": "String - Brief summary (e.g. 'Muscle attachments of the maxilla and palatine surfaces.')",
  "detailedNotes": "String - FULL EXHAUSTIVE NOTES combining your OCR analysis, visual picture data, and provided text. Make this as detailed as physically possible. Include every mechanism, definition, process. Use deep markdown formatting (lists, bolding, italics).",
  "metadata": {
    "visual_density_score": Number (1-10),
    "hardness": Number (1-10),
    "yield": "String (e.g. 'high', 'medium', 'low')",
    "category": "String (e.g. 'Biochemistry', 'Anatomy')"
  },
  "ui_elements": {
    "card_color": "Hex color string (e.g. '#8E44AD')",
    "icon": "Lucide icon name (e.g. 'Activity', 'Brain', 'Droplet', 'Zap')",
    "priority_label": "String (e.g. 'HIGH YIELD', 'CRITICAL')"
  },
  "schedule": {
    "next_review_utc_offset_hours": Number (How many hours until the first review? e.g. 24),
    "bandwidth_weight": Number (0.1 to 1.0)
  },
  "reminder_copy": "String - short conversational reminder text. E.g. 'Time to review those maxillary surface attachments. You noted this was dense yesterday.'",
  "sub_topics": [
    { 
      "title": "String", 
      "details": "String",
      "sub_items": ["String", "String"] 
    }
  ],
  "flashcards": [
    {
      "question": "String - highly detailed question or fill-in-the-blank (e.g. 'The ___ pathway is responsible for...')",
      "answer": "String - comprehensive exhaustive answer with markdown formatting"
    }
  ]
}
Ensure the output is ONLY valid JSON. Include at least 15 extremely high quality flashcards based on every detail of the note.
      `;

      const parts: any[] = [{ text: prompt }];

      if (base64Images && Array.isArray(base64Images)) {
        for (const img of base64Images) {
          if (img && img.data && img.mimeType) {
             parts.push({
               inlineData: {
                 data: img.data,
                 mimeType: img.mimeType
               }
             });
          }
        }
      }

      let response;
      let retries = 3;
      let delayMs = 1000;
      while (retries > 0) {
        try {
          response = await ai.models.generateContent({
             model: modelId,
             contents: { parts },
             config: {
               responseMimeType: "application/json"
             }
          });
          break; // success
        } catch (err: any) {
          console.error(`Gemini API Error, retries left: ${retries - 1}`, err.message);
          if (retries === 1) throw err;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs *= 2;
          retries--;
        }
      }

      const text = response?.text;
      if (!text) {
         throw new Error("No text returned from Gemini");
      }
      console.log("Raw Gemini Response:", text);
      
      let jsonStr = text.trim();
      if (jsonStr.startsWith("```json")) {
        jsonStr = jsonStr.substring(7);
      } else if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.substring(3);
      }
      if (jsonStr.endsWith("```")) {
        jsonStr = jsonStr.substring(0, jsonStr.length - 3);
      }
      jsonStr = jsonStr.trim();

      let topicsParsed;
      try {
        topicsParsed = JSON.parse(jsonStr);
        if (!Array.isArray(topicsParsed)) {
          topicsParsed = [topicsParsed];
        }
      } catch (err) {
        throw new Error("Failed to parse JSON. Raw output: " + jsonStr.substring(0, 100) + "...");
      }

      res.json({ topics: topicsParsed });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  });


  app.post("/api/generate-flashcards", async (req, res) => {
    try {
      console.log("Generating flashcards...");
      const { topicTitle, topicDescription, detailedNotes, subTopics, userPrompt, numFlashcards } = req.body;
      const apiKey = req.body.customAiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set.");
      }

      const config: any = { apiKey };
      if (req.body.customAiUrl) {
         config.httpOptions = { baseUrl: req.body.customAiUrl };
      }
      
      const ai = new GoogleGenAI(config);
      const modelId = req.body.customAiModel || 'gemini-2.5-flash';
      const prompt = `
You are an EXTREMELY METICULOUS flashcard generation engine for a highly advanced Revision App. 
Below are the FULL detailed notes, sub-topics, and description of a study topic, which were previously extracted from detailed study materials (including picture analysis).

### MANDATORY DIRECTIVE: Exhaustive Line-by-Line Coverage
Your absolute mandate is to exhaustively cover EVERY SINGLE DETAIL, CONCEPT, FACT, AND LINE from the notes. 
If the text contains 50 distinct facts, you MUST generate at least 50 flashcards. Leave absolutely nothing out. No concept or definition is too small. 
Do NOT group multiple unrelated facts into one card. Break down complex paragraphs into multiple granular flashcards.

Title: ${topicTitle}
Description: ${topicDescription}
Detailed Notes / Full Text: 
${detailedNotes}

SubTopics Summary: 
${JSON.stringify(subTopics)}

Target number of cards: ${numFlashcards || 20}.
HOWEVER, if the source material contains more concepts, you MUST generate MORE than the target to ensure 100% complete coverage of the notes above.

User Custom Instructions for this generation: ${userPrompt || "Make them highly detailed and include advanced question types like fill-in-the-blanks. Include every single granular detail."}

Rules:
1. Do not skip ANY details from the "Detailed Notes / Full Text". Ensure literally every fact, mechanism, and nuanced piece of data is converted into active recall questions.
2. Formulate "questions" that ask for specific mechanisms, definitions, or bullet points. Ask very specific, granular questions. 
3. Include advanced question types like fill-in-the-blanks (e.g. "The ___ pathway is responsible for...").
4. The "answer" should be comprehensive, accurate, and use Markdown formatting where appropriate (bolding keywords, using lists).

Output Format: A JSON array of objects matching this schema:
[
  {
    "question": "String",
    "answer": "String with Markdown formatting"
  }
]
Ensure the output is ONLY valid JSON array.
      `;

      let response;
      let retries = 3;
      let delayMs = 1000;
      while (retries > 0) {
        try {
          response = await ai.models.generateContent({
             model: modelId,
             contents: prompt,
             config: {
               responseMimeType: "application/json"
             }
          });
          break;
        } catch (err: any) {
          console.error(`Gemini API Error, retries left: ${retries - 1}`, err.message);
          if (retries === 1) throw err;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs *= 2;
          retries--;
        }
      }

      let text = response?.text;
      if (!text) {
         throw new Error("No text returned from Gemini");
      }
      
      let jsonStr = text.trim();
      if (jsonStr.startsWith("```json")) {
        jsonStr = jsonStr.substring(7);
      } else if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.substring(3);
      }
      if (jsonStr.endsWith("```")) {
        jsonStr = jsonStr.substring(0, jsonStr.length - 3);
      }
      jsonStr = jsonStr.trim();

      let flashcards;
      try {
        flashcards = JSON.parse(jsonStr);
        if (!Array.isArray(flashcards)) {
           // Fallback in case the model returns an object wrapped array
           flashcards = flashcards.flashcards || [flashcards];
        }
      } catch (err) {
        throw new Error("Failed to parse JSON for flashcards.");
      }

      res.json({ flashcards });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
