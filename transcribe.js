import { Supadata } from "@supadata/js";
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import express from "express";
import dotenv from "dotenv";

dotenv.config({});

const app = express();
app.use(express.json());

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

    //BAsed on jobId
    if ("jobId" in job) {
      console.log(job.jobId);
      let jobResult = await supadata.transcript.getJobStatus(job.jobId);

      while (jobResult.status === "queued" || jobResult.status === "active") {
        await new Promise((r) => setTimeout(r, 3000));
        jobResult = await supadata.transcript.getJobStatus(job.jobId);
        console.log(jobResult.status);
      }
      if (jobResult.status === "failed") {
        res.status(404).json({
          status: "failed",
          transcript: null,
        });
      }
      console.log(jobResult.status);
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

app.listen("3000||process.env.PORT", () => {
  console.log("server started");
});
