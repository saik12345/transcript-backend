import { Supadata } from "@supadata/js";
import { GoogleGenAI } from "@google/genai";
import PDFDocument from "pdfkit";
import cors from "cors";
import * as fs from "fs";
import express from "express";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({});

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

//-----------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const YT_KEY=process.env.YT_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
let supadata = "";
let val = 1;
// let check=false;

let supadataenv = process.env.supadata_key_1;

async function getProperKey({ errorCode = null } = {}) {
  if (errorCode) {
    const { data, error } = await supabase
      .from("apicounter")
      .update({ keyno: (val + 1) % 5 })
      .eq("id", 1)
      .select("keyno");
    val = data[0].keyno;
    console.log("after error val ", val);
    supadataenv = process.env[`supadata_key_${val}`];
    supadata = new Supadata({
      apiKey: supadataenv,
    });
    // console.log("env", process.env[`supadata_key_${val}`]);
  } else {
    console.log("val", val);
    let { data: apicounter, error } = await supabase
      .from("apicounter")
      .select("keyno")
      .eq("id", 1);
    console.log(apicounter);
    val = apicounter[0].keyno;
    console.log("val", val);
    supadataenv = process.env[`supadata_key_${val}`];
    supadata = new Supadata({
      apiKey: supadataenv,
    });
    console.log("env", process.env[`supadata_key_${val}`]);
    // return val;
  }
}


async function checkAvailableForTranscription() {
  const { data, error } = await supabase
    .from('apicounter')
    .select('Date, totalReq')
    .eq('id', 1)
    .single();

  if (error) {
    console.error(error);
    return false;
  }

  const today = new Date().toISOString().split('T')[0];

  const storedDate = data.Date;       // "YYYY-MM-DD"
  const totalReq = data.totalReq;     // number

  // Case 1: same day & under limit
  if (storedDate === today && totalReq < 5) {
    return true;
  }

  // Case 2: same day & limit reached
  if (storedDate === today && totalReq >= 5) {
    return false;
  }

  // Case 3: new day → reset counter & date
  if (storedDate !== today) {
    await supabase
      .from('apicounter')
      .update({
        Date: today,
        totalReq: 0
      })
      .eq('id', 1);

    return true;
  }
}

await getProperKey();

const ai = new GoogleGenAI({ apiKey: process.env.gemini_key });

console.log(process.env[`supadata_key_${val}`]);
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
  console.log("====health check====");
  res.status(200).json({
    data: "working",
    val: val,
  });
});

app.post("/videoTitle",async(req,res)=>{
  console.log("fetching video title...");
  const url=req.body.url;
  console.log(url);
  const urlId=toStandardYouTube(url)?.split('=')[1];
  const title=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${urlId}&key=${process.env.YT_KEY}`);
  const data=await title.json();
  return res.status(200).json({
    title:data.items[0].snippet.title
  })
})

app.post("/getTranscription", async (req, res) => {

  if(checkAvailableForTranscription()===true)
  {
    
  let transcriptText='';
  let jobResult;
  await getProperKey();
  try {
    const reqUrl = req.body.reqUrl;
    const cleanUrl = toStandardYouTube(reqUrl);
    console.log(cleanUrl);

//1st try with youtube to transcript api service

    
const yttResponse=await fetch(`https://transcriptapi.com/api/v2/youtube/transcript?video_url=${cleanUrl}&format=json&include_timestamp=false`,{
  method:'GET',
  headers: {
    "Authorization": `Bearer ${process.env.YTT_TOKEN}`,
    "Content-Type": "application/json"
  }
})
           
if (yttResponse.status === 200) {

const { data, error } = await supabase
  .from('apicounter')
  .update({ totalReq: totalReq + 1 })
  .eq('id', 1)
  .select('totalReq')
  
  const yttData = await yttResponse.json();
  // console.log("yttResponse:", yttData);
   console.log("yttResponse: completed");
  const yttTranscript=(yttData?.transcript??[]).map(el=>el.text).join(' ');
  return res.status(200).json({
    code: res.statusCode,
    status: "completed",
    transcript: yttTranscript,
  })
} 


 //2nd try the supadata service   
    const job = await supadata.transcript({
      url: cleanUrl,
      text: true,
      mode: "auto",
    });
    //console.log("Job", job);

    //BAsed on jobId
    if ("jobId" in job) {
      console.log("SUPADATA JOB_ID ",job.jobId);
      jobResult = await supadata.transcript.getJobStatus(job.jobId);
      console.log(jobResult?.status);

      while (jobResult.status === "queued" || jobResult.status === "active") {
        await new Promise((r) => setTimeout(r, 15000));
        jobResult = await supadata.transcript.getJobStatus(job.jobId);
        // console.log("Job Result", jobResult);
        // console.log(jobResult.status);
      }
      if (jobResult.status === "failed") {
        return res.status(404).json({
          code: res.statusCode,
          status: "failed",
          message: "The transcript couldnt be generated",
        });
      }
      console.log("Job Result status : ", jobResult.status);
      // console.log(jobResult);
      // return res.status(200).json({
      //   code: res.statusCode,
      //   status: "completed",
      //   transcript: jobResult.content,
      // });
    }
    else{
      jobResult=job;
      // console.log("Job Result",jobResult);
    }
    // ========Finally getting the correct transcript here==========
    //=========We check if its and array or string==================

    if(typeof jobResult.content==="string"){
      transcriptText=jobResult.content;
    }
    if(Array.isArray(jobResult.content)){
      transcriptText=jobResult.content.map(x=>x.text || "").join(" ");
    }
    
    return res.status(200).json({
      code: res.statusCode,
      status: "completed",
      transcript: transcriptText,
    });
  } catch (error) {
    console.log("Try-catch error block", error);

    if (error.error.includes("limit-exceeded")) {
      console.log("inside limit exceded scope");
      await getProperKey({ errorCode: 429 });
      return res.status(400).json({
        code: error.error,
        status: "error",
        message: `${error}`,
      });
    } else if (error) {
      return res.status(400).json({
        code: error.error,
        status: "error",
        message: `${error}`,
      });
    }
  }
}else{
    console.log("5 limits for day reached")
    return res.status(400).json({
      status:"error",
      message:"You have used up 5 limits for the day"
    })
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
    // console.log(response.text);
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
      contents: `${text}.keep Streaming the output but strictly make sure you complete and not stop abruptly. Correct only the grammar part keeping the structure of the sentence same. Don't change the tone or reduce the length of sentences. Don't add anything new. Don't change the number of sentences or reduce the length of the content. Remove any unnecessary words like 'hmm',[sound] etc.keep Streaming the output but make sure you complete and not stop abruptly. Don't use any \n \\ etc.Mandatorily the output language should be in english and you should translate to english only given the original text provided to you be in some other language. English is mandatory`,
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
