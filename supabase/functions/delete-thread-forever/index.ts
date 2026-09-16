// Permanently deletes a thread: removes every attachment's file from
// Storage, then deletes the thread row (messages and attachment rows
// cascade via their FKs). This is deliberately a separate, server-side
// action from the soft "move to trash" (a plain threads.deleted_at update
// the client can do directly under RLS) - actually destroying files needs
// the service role, and doing it here keeps that irreversible step behind
// one clear, auditable entry point rather than granting broad client-side
// delete access to storage.objects.
//
// Available to the mailbox's own owner or an admin, same ownership rule as
// everything else - deleting your own trash doesn't require being an
// admin.

import { supabaseAdmin, supabaseAsCaller } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";

interface Body {
  threadId: string;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  const callerClient = supabaseAsCaller(authHeader);
  const { data: userResult, error: userError } = await callerClient.auth.getUser();
  if (userError || !userResult?.user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.threadId) return jsonResponse({ error: "threadId is required" }, 400);

  const admin = supabaseAdmin();

  // Ownership check via RLS: this select runs as the caller, so it only
  // returns a row if they actually own the thread's mailbox (or are admin).
  const { data: thread, error: threadError } = await callerClient
    .from("threads")
    .select("id, mailbox_id")
    .eq("id", body.threadId)
    .maybeSingle();
  if (threadError || !thread) {
    return jsonResponse({ error: "Thread not found or not yours" }, 404);
  }

  const { data: attachments, error: attachmentsError } = await admin
    .from("attachments")
    .select("storage_path")
    .in(
      "message_id",
      (
        await admin.from("messages").select("id").eq("thread_id", thread.id)
      ).data?.map((m) => m.id) ?? [],
    );
  if (attachmentsError) {
    return jsonResponse({ error: `Failed to list attachments: ${attachmentsError.message}` }, 500);
  }

  const paths = (attachments ?? []).map((a) => a.storage_path as string);
  if (paths.length > 0) {
    const { error: removeError } = await admin.storage.from("attachments").remove(paths);
    if (removeError) {
      // Don't block the delete on storage cleanup failing - an orphaned
      // file is a much smaller problem than a "delete forever" that
      // silently doesn't delete.
      console.error("delete-thread-forever: failed to remove some storage objects", removeError);
    }
  }

  const { error: deleteError } = await admin.from("threads").delete().eq("id", thread.id);
  if (deleteError) {
    return jsonResponse({ error: `Failed to delete thread: ${deleteError.message}` }, 500);
  }

  return jsonResponse({ ok: true });
});
