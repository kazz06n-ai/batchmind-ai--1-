import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { grokRequest } from "./src/lib/grok";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
export default app;

async function startServer() {
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

  // Supabase Setup
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
  
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("⚠️ SUPABASE_URL or SUPABASE_ANON_KEY is missing. Backend features will fail.");
    console.warn("Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment or .env file.");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Grok API Setup (no client needed, use grokRequest)

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "BatchMind AI Backend Active" });
  });

  app.post("/api/auth/sync-profile", async (req, res) => {
    const { id, displayName } = req.body;
    try {
      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!profile) {
        const { error: insertError } = await supabase.from('profiles').insert([{
          id,
          display_name: displayName,
          credibility_score: 0
        }]);
        if (insertError) throw insertError;
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/batches/sync", async (req, res) => {
    const { userId } = req.body;
    try {
      // 1. Get batches where user is a member
      const { data: memberships, error: memberError } = await supabase
        .from('batch_members')
        .select('batch_id')
        .eq('user_id', userId);
      
      if (memberError) throw memberError;

      if (memberships && memberships.length > 0) {
        const batchIds = memberships.map(m => m.batch_id);
        const { data: batches, error: fetchError } = await supabase
          .from('batches')
          .select('*')
          .in('id', batchIds);
        
        if (fetchError) throw fetchError;
        return res.json(batches);
      }

      // 2. If no memberships, check if any public batches exist or create a default one
      const { data: batches, error: fetchError } = await supabase
        .from('batches')
        .select('*')
        .eq('name', 'General Batch')
        .limit(1);
      
      if (fetchError) throw fetchError;

      let targetBatch;
      if (batches && batches.length > 0) {
        targetBatch = batches[0];
      } else {
        // Create default batch if none exist
        const { data: newBatch, error: insertError } = await supabase
          .from('batches')
          .insert([{ 
            name: 'General Batch', 
            university: 'Global',
            invite_code: Math.random().toString(36).substring(2, 8).toUpperCase()
          }])
          .select()
          .single();
        
        if (insertError) throw insertError;
        targetBatch = newBatch;
      }

      // Add user to the batch
      await supabase.from('batch_members').insert([{
        batch_id: targetBatch.id,
        user_id: userId,
        role: 'member'
      }]);

      res.json([targetBatch]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/batches/create", async (req, res) => {
    const { name, university, userId } = req.body;
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    try {
      console.log(`[Create Batch] Name: ${name}, User: ${userId}`);
      
      // 1. Create the batch - trigger will automatically add creator as admin
      const { data: batch, error: batchError } = await supabase
        .from('batches')
        .insert([{ 
          name, 
          university: university || 'Global', 
          invite_code: inviteCode, 
          created_by: userId 
        }])
        .select()
        .single();
      
      if (batchError) {
        console.error("Batch Creation Error Details:", JSON.stringify(batchError, null, 2));
        throw batchError;
      }

      res.json(batch);
    } catch (error: any) {
      console.error("Final Create Batch Error Details:", JSON.stringify(error, null, 2));
      res.status(500).json({ 
        error: error.message || "Failed to create batch",
        details: error.details || null,
        hint: error.hint || null
      });
    }
  });

  app.post("/api/batches/join", async (req, res) => {
    const { inviteCode, userId } = req.body;

    try {
      const { data: batch, error: batchError } = await supabase
        .from('batches')
        .select('*')
        .eq('invite_code', inviteCode.toUpperCase())
        .single();
      
      if (batchError || !batch) {
        return res.status(404).json({ error: "Invalid invite code" });
      }

      // Check if already a member
      const { data: existing, error: existingErr } = await supabase
        .from('batch_members')
        .select('*')
        .eq('batch_id', batch.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) {
        return res.json(batch);
      }

      const { error: memberError } = await supabase
        .from('batch_members')
        .insert([{ batch_id: batch.id, user_id: userId, role: 'member' }]);
      
      if (memberError) throw memberError;

      res.json(batch);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/batches/request-notes", async (req, res) => {
    const { fromBatchId, toBatchName, requestedBy, message } = req.body;

    try {
      // Find target batch by name
      const { data: targetBatch, error: batchError } = await supabase
        .from('batches')
        .select('id')
        .eq('name', toBatchName)
        .single();
      
      if (batchError || !targetBatch) {
        return res.status(404).json({ error: "Target batch not found" });
      }

      const { data: request, error: requestError } = await supabase
        .from('batch_requests')
        .insert([{
          from_batch_id: fromBatchId,
          to_batch_id: targetBatch.id,
          requested_by: requestedBy,
          message,
          status: 'pending'
        }])
        .select()
        .single();
      
      if (requestError) throw requestError;

      // Notify target batch members (simplified: notify creator)
      const { data: targetBatchInfo } = await supabase.from('batches').select('created_by').eq('id', targetBatch.id).single();
      if (targetBatchInfo?.created_by) {
        await supabase.from('notifications').insert([{
          user_id: targetBatchInfo.created_by,
          message: `New note request from another batch: ${message}`
        }]);
      }

      res.json(request);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/batches/requests/:batchId", async (req, res) => {
    const { batchId } = req.params;
    try {
      const { data, error } = await supabase
        .from('batch_requests')
        .select('*, from_batch:batches!from_batch_id(name)')
        .eq('to_batch_id', batchId)
        .eq('status', 'pending');
      
      if (error) throw error;
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/batches/:batchId/notes", async (req, res) => {
    const { batchId } = req.params;
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('batch_id', batchId)
        .order('upvotes', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // RAG Endpoint: Generate Embeddings & Query
  app.post("/api/ai/query", async (req, res) => {
    const { query, batchId, chatHistory } = req.body;

    if (!query || !batchId) {
      return res.status(400).json({ error: "Query and batchId are required" });
    }

    try {
      console.log(`[AI Query] Batch: ${batchId}, Query: ${query}`);

      let matchedNotes: any[] | null = null;

      try {
        const embeddingResponse = await grokRequest("embeddings", { input: query });
        const embedding = embeddingResponse.embedding;
        if (embedding) {
          const { data, error: matchError } = await supabase.rpc("match_notes", {
            query_embedding: embedding,
            match_threshold: 0.2,
            match_count: 10,
            p_batch_id: batchId
          });
          if (!matchError && data && data.length > 0) matchedNotes = data;
        }
      } catch (embedOrRpcErr) {
        console.warn("[AI Query] Embedding/RPC fallback:", (embedOrRpcErr as Error).message);
      }

      if (!matchedNotes || matchedNotes.length === 0) {
        const { data: allNotes } = await supabase
          .from('notes')
          .select('*')
          .eq('batch_id', batchId)
          .order('created_at', { ascending: false })
          .limit(50);
        matchedNotes = allNotes || [];
      }

      const context = matchedNotes && matchedNotes.length > 0
        ? matchedNotes.map((n: any) => `[Note: ${n.title}] [Subject: ${n.subject || 'General'}] [Date: ${n.created_at}]\n${n.content}`).join("\n\n---\n\n")
        : "No relevant notes found.";

      // 4. Determine response type based on query
      let responseType = 'text';
      let responseSchema: any = null;

      if (query.toLowerCase().includes('flashcard')) {
        responseType = 'flashcards';
        responseSchema = {
          type: "array",
          items: {
            type: "object",
            properties: {
              front: { type: "string" },
              back: { type: "string" }
            },
            required: ["front", "back"]
          }
        };
      } else if (query.toLowerCase().includes('quiz')) {
        responseType = 'quiz';
        responseSchema = {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              answer: { type: "string" },
              explanation: { type: "string" }
            },
            required: ["question", "options", "answer"]
          }
        };
      }

      const systemPrompt = `
        You are BatchMind AI, a specialized academic assistant.
        Your goal is to answer questions, generate flashcards, or create quizzes based ONLY on the provided context.
        
        CONTEXT FROM BATCH NOTES:
        ${context}
        
        STRICT RULES:
        ${responseType === 'flashcards' ? `1. ONLY return a JSON array of {front, back} objects. Return NOTHING else.
        Example: [{"front": "What is X?", "back": "X is..."}]` : ''}
        ${responseType === 'quiz' ? `1. ONLY return a JSON array of {question, options, answer, explanation} objects. Return NOTHING else.
        Example: [{"question": "Q?", "options": ["A", "B"], "answer": "A", "explanation": "..."}]` : ''}
        ${responseType === 'text' ? `1. Answer the question using the context. If not in context, say so clearly.` : ''}
        2. If the answer is not in the context, clearly state that notes are missing for this specific request.
        3. Be concise and accurate.
      `;

      // 5. Generate answer using Grok (OpenAI-style messages)
      const result = await grokRequest("chat", {
        systemPrompt,
        userMessage: query,
        history: chatHistory || [],
      });

      let answer = result.text || result.answer || '';
      let finalData: any = null;

      // Try to extract and parse JSON if this is a flashcard or quiz request
      if (responseType !== 'text' && answer) {
        try {
          // Try direct parsing first
          finalData = JSON.parse(answer);
        } catch (_e1) {
          // Try extracting from markdown code blocks
          const jsonMatch = answer.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
          if (jsonMatch && jsonMatch[1]) {
            try {
              finalData = JSON.parse(jsonMatch[1]);
            } catch (_e2) {
              // If still fails, keep answer as fallback text
              console.warn(`[AI Query] Failed to parse ${responseType} JSON, keeping as text`);
            }
          }
        }
      }

      res.json({ 
        answer: answer,
        type: responseType,
        data: finalData, // Send parsed data directly, not nested in answer
        sources: matchedNotes?.map((n: any) => ({ id: n.id, title: n.title })) || []
      });
    } catch (error: any) {
      console.error("AI Query Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // New Endpoint: Batch Summary
  app.post("/api/ai/batch-summary", async (req, res) => {
    const { batchId } = req.body;
    if (!batchId) {
      console.error("/api/ai/batch-summary: batchId missing in request body", req.body);
      return res.status(400).json({ error: "batchId is required" });
    }
    try {
      const { data: notes, error } = await supabase
        .from('notes')
        .select('title, content, subject, created_at')
        .eq('batch_id', batchId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error("/api/ai/batch-summary: Supabase error", error);
        return res.status(500).json({ error: error.message, summary: '' });
      }

      const context = Array.isArray(notes) && notes.length > 0
        ? notes.map(n => `[${n.created_at}] [${n.subject}] ${n.title}: ${n.content}`).join('\n')
        : '';

      if (!context || context.trim() === '') {
        return res.json({ summary: 'No notes in this batch yet. Add notes to see an AI summary here.' });
      }

      try {
        const result = await grokRequest("chat", {
          prompt: `You are an academic organizer. Use the following notes to create a structured summary grouped by Subject and then Date.\n\nNOTES:\n${context}\nSummarize these notes by date and subject in an orderly manner.`,
        });
        return res.json({ summary: result.text || result.answer || '' });
      } catch (grokErr: any) {
        console.error("/api/ai/batch-summary: Grok error", grokErr);
        return res.json({ summary: `Summary unavailable: ${grokErr?.message || 'AI error'}. You can still read the notes above.` });
      }
    } catch (error: any) {
      console.error("/api/ai/batch-summary: Caught error", error);
      res.status(500).json({ error: error?.message || String(error), summary: '' });
    }
  });

  // Note Processing: Generate Embedding on Create/Update
  app.post("/api/notes/create", async (req, res) => {
    const { batchId, title, content, subject, authorId, authorName } = req.body;

    try {
      // 1. Insert note
      const { data: note, error: insertError } = await supabase
        .from("notes")
        .insert([{
          batch_id: batchId,
          title,
          content,
          subject: subject || 'General',
          author_id: authorId,
          author_name: authorName
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      // 2. Generate embedding (async)
      try {
        const embeddingResponse = await grokRequest("embeddings", { input: content });
        if (embeddingResponse.embedding) {
          await supabase.from("notes").update({ embedding: embeddingResponse.embedding }).eq("id", note.id);
        }
      } catch (embedError) {
        console.error("Embedding generation failed for note:", note.id, embedError);
        // We don't fail the whole request if embedding fails, 
        // but the note won't be searchable via AI until re-indexed
      }

      // 3. Create notifications for other users in the batch
      // For simplicity in hackathon, we'll notify all users except the author
      const { data: users } = await supabase.from('profiles').select('id').neq('id', authorId);
      if (users) {
        const notifications = users.map(u => ({
          user_id: u.id,
          message: `${authorName} uploaded a new note: ${title}`
        }));
        await supabase.from('notifications').insert(notifications);
      }

      res.json(note);
    } catch (error: any) {
      console.error("Create Note Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/notes/vote", async (req, res) => {
    const { noteId, type, authorId, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required to vote" });
    }

    try {
      // 1. Check if user has already voted on this note
      const { data: existingVote, error: voteCheckError } = await supabase
        .from('note_votes')
        .select('*')
        .eq('note_id', noteId)
        .eq('user_id', userId)
        .maybeSingle();

      if (voteCheckError) throw voteCheckError;

      if (existingVote) {
        return res.status(400).json({ error: "You have already voted on this note" });
      }

      // 2. Register the vote
      const { error: registerError } = await supabase
        .from('note_votes')
        .insert([{ note_id: noteId, user_id: userId, vote_type: type }]);
      
      if (registerError) throw registerError;

      // 3. Update note votes count
      const { data: note, error: fetchError } = await supabase
        .from('notes')
        .select('upvotes, downvotes')
        .eq('id', noteId)
        .single();

      if (fetchError) throw fetchError;

      const updates = type === 'up' 
        ? { upvotes: note.upvotes + 1 } 
        : { downvotes: note.downvotes + 1 };

      await supabase.from('notes').update(updates).eq('id', noteId);

      // 4. Update author credibility score (The Credibility Index)
      // Upvote = +10, Downvote = -5
      const { data: profile } = await supabase
        .from('profiles')
        .select('credibility_score')
        .eq('id', authorId)
        .single();

      if (profile) {
        const newScore = type === 'up' 
          ? profile.credibility_score + 10 
          : Math.max(0, profile.credibility_score - 5);
        
        await supabase.from('profiles').update({ credibility_score: newScore }).eq('id', authorId);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Vote Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Note Processing: Generate Embedding on Create/Update (Legacy, keeping for compatibility if needed)
  app.post("/api/notes/embed", async (req, res) => {
    const { noteId, content } = req.body;

    try {
      const embeddingResponse = await grokRequest("embeddings", { input: content });
      const embedding = embeddingResponse.embedding;

      const { error } = await supabase
        .from("notes")
        .update({ embedding })
        .eq("id", noteId);

      if (error) throw error;

      res.json({ success: true });
    } catch (error: any) {
      console.error("Embedding Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" || process.env.VITE_DEV === "true") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: {
          overlay: false,
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`BatchMind AI Server running on http://localhost:${PORT}`);
    });
  }
}

// Only start the server if this file is run directly
const isMain = process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url));
if (isMain || !process.env.VERCEL) {
  startServer();
}
