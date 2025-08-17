import { Supadata } from "@supadata/js";
import { GoogleGenAI } from "@google/genai";
import PDFDocument from "pdfkit";
import cors from "cors";
import * as fs from "fs";
import express from "express";
import dotenv from "dotenv";

dotenv.config({});

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const supadata = new Supadata({ apiKey: process.env.supadata_key });
const ai = new GoogleGenAI({ apiKey: process.env.gemini_key });
console.log(process.env.supadata_key);
console.log(process.env.gemini_key);

//----------------------
function toStandardYouTube(url) {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|v\/|live\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? "https://www.youtube.com/watch?v=" + match[1] : null;
}
//---------------------------------

app.get("/", async (req, res) => {
  console.log("health check");
  res.status(200).json({
    data: "working",
  });
});

app.post("/getTranscription", async (req, res) => {
  try {
    const reqUrl = req.body.reqUrl;
    const cleanUrl = toStandardYouTube(reqUrl);
    console.log(cleanUrl);
    const job = await supadata.transcript({
      url: cleanUrl,
      text: true,
      mode: "auto",
    });
    console.log("Job", job);

    //BAsed on jobId
    if ("jobId" in job) {
      console.log(job.jobId);
      let jobResult = await supadata.transcript.getJobStatus(job.jobId);

      while (jobResult.status === "queued" || jobResult.status === "active") {
        await new Promise((r) => setTimeout(r, 5000));
        jobResult = await supadata.transcript.getJobStatus(job.jobId);
        console.log("Job Result", jobResult);
        console.log(jobResult.status);
      }
      if (jobResult.status === "failed") {
        return res.status(404).json({
          status: "failed",
          message: "The transcript couldnt be generated",
        });
      }
      console.log(jobResult.status);
      console.log(jobResult);
      return res.status(200).json({
        status: "completed",
        transcript: jobResult.content,
      });
    }
    // console.log(job.content);
    res.status(200).json({
      status: "completed",
      transcript: job.content,
    });
  } catch (error) {
    console.log(error);
    console.log(typeof error);
    // const err = JSON.stringify(error);
    console.dir(error);
    res.status(400).send({
      status: "error",
      message: `${error}`,
    });
  }
});

app.post("/aitranscript", async (req, res) => {
  try {
    let text = req.body.text;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${text}.Correct only the grammar part keeping the structure of the sentence same.Dont change the tone or dont reduce the length of sentences.Dont add anything new.Dont change the number of sentences or dont reduce the length of the content.Remove any unnecessary words like 'hmm',[sound] etc.Must give the output in one go and not in parts. Ensure the full output is returned at once. Dont return the text in parts.Dont use any \n \\ etc`,
      config: {
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
        },
      },
    });
    console.log(response.text);
    res.status(200).json({
      status: "completed",
      transcript: `${response.text}`,
    });
  } catch (err) {
    console.log(err);
    res.status(400).json({
      status: "error",
      message: `${err}`,
    });
  }
});

app.post("/streamaitranscript", async (req, res) => {
  try {
    const text = req.body.text;
    console.log(text.slice(0, 10));
    // Set the headers for a stream response
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");

    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: `${text}.keep Streaming the output but strictly make sure you complete and not stop abruptly. Correct only the grammar part keeping the structure of the sentence same. Don't change the tone or reduce the length of sentences. Don't add anything new. Don't change the number of sentences or reduce the length of the content. Remove any unnecessary words like 'hmm',[sound] etc.keep Streaming the output but make sure you complete and not stop abruptly. Don't use any \n \\ etc.`,
      config: {
        thinkingConfig: {
          thinkingBudget: 0,
        },
        generationConfig: {
          temperature: 0.3,
        },
      },
    });

    for await (const chunk of stream) {
      if (chunk?.text) {
        // console.log(chunk.text);
        res.write(chunk.text);
      }
    }

    res.end(); // Signal that streaming is complete
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: `${err}`,
    });
  }
});

app.post("/getpdf", async (req, res) => {
  try {
    let text = req.body.text;

    // Step 1: Clean text
    let cleanText = text.replace(/\\n/g, " ").replace(/\\/g, " ");

    // Step 2: Split into words
    const words = cleanText.split(/\s+/);

    // Step 3: Insert line breaks after every 500 words
    let lines = [];
    for (let i = 0; i < words.length; i += 500) {
      lines.push(words.slice(i, i + 500).join(" "));
    }

    // Step 4: Prepare PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${new Date()
        .toLocaleDateString("en-GB")
        .slice(0, 8)}.pdf"`
    );

    const doc = new PDFDocument({ autoFirstPage: false });
    doc.pipe(res);

    const linesPerPage = 100;
    let pageNumber = 1;

    // Step 5: Add pages and lines
    for (let i = 0; i < lines.length; i += linesPerPage) {
      doc.addPage();
      const pageLines = lines.slice(i, i + linesPerPage);

      doc.text(pageLines.join("\n"), 50, 50, { width: 500 });

      // page number at bottom
      doc.text(`Page ${pageNumber}`, 0, 750, { align: "center" });
      pageNumber++;
    }

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(400).json({ status: "Error", message: `${err}` });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("server started");
});
