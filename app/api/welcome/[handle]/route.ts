import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleRouteError, jsonError, readJsonBody, readMultipart } from "@/lib/api";
import { publicEnv } from "@/lib/config";
import { fetchWelcomeHtml, visibilityAllows } from "@/lib/profile";
import { WelcomePreviewSchema } from "@/lib/profile-schema";
import { buildWelcomeDoc, safeOrigin, welcomeHeaders } from "@/lib/welcome-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A profile's welcome animation, as its own document.
 *
 * This route exists so the author's HTML never touches the page a visitor is
 * signed in on. It is framed with `sandbox="allow-scripts"` and answers with a CSP
 * that repeats the sandbox and sets `default-src 'none'` — see `lib/welcome-doc.ts`
 * for why each piece of that is there.
 *
 * The response reflects nothing from the request: only the stored column, the
 * stored accent, and the author's display name.
 */
function origin() {
  return safeOrigin(publicEnv.siteUrl);
}

function blank(cacheable: boolean) {
  // An empty document rather than a 404: the frame is already in the page by the
  // time this is fetched, and a 404 there paints a browser error page inside it.
  return new NextResponse("<!doctype html><title>Intro</title>", {
    status: 200,
    headers: welcomeHeaders(origin(), cacheable),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const row = await fetchWelcomeHtml(handle);

    if (!row || !row.enabled || !row.html) return blank(true);

    // A `SIGNED_IN` profile's intro is part of the profile, so it is gated the
    // same way. Enforced here rather than only where the frame is rendered.
    const viewer = await getCurrentUser();
    if (!visibilityAllows(row.visibility, viewer?.id ?? null)) return blank(true);

    const doc = buildWelcomeDoc({
      html: row.html,
      title: `${row.displayName} — intro`,
      accent: row.accent,
    });
    return new NextResponse(doc, { status: 200, headers: welcomeHeaders(origin(), true) });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * The live preview in the settings editor: the same document, built from unsaved
 * draft HTML in the body.
 *
 * Same route, same builder, same headers — so what you preview is exactly what
 * ships. Owner-only, because otherwise this would be an open endpoint that renders
 * arbitrary attacker HTML on our origin, which is the thing the whole design is
 * built to avoid handing out.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const url = new URL(request.url);
    if (url.searchParams.get("preview") !== "1") {
      return jsonError("Unknown action.", 400);
    }

    const viewer = await getCurrentUser();
    if (!viewer) return jsonError("Sign in first.", 401);
    if (viewer.handle !== handle) return jsonError("Preview your own profile.", 403);

    const parsed = WelcomePreviewSchema.safeParse(await readPreviewInput(request));
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "That HTML is too long.", 400);
    }

    const doc = buildWelcomeDoc({
      html: parsed.data.html,
      title: `${viewer.displayName} — intro preview`,
      // Validated by the schema and again by the builder, so an unvalidated colour
      // cannot reach the style block by way of the preview endpoint.
      accent: parsed.data.accent ?? null,
    });
    return new NextResponse(doc, { status: 200, headers: welcomeHeaders(origin(), false) });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Accept the draft as either JSON or a form body.
 *
 * The form body is the one the editor actually uses: it submits a real `<form>`
 * targeting the preview iframe, so the response document lands in the frame *with
 * these headers on it*. The alternative — fetching the HTML and handing it to the
 * frame as a blob or `srcdoc` — would drop the CSP and let the frame inherit the
 * page's instead, which is precisely the trap this route was built to avoid. JSON
 * stays supported because it is the obvious shape for anything scripted.
 */
async function readPreviewInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("form")) {
    const form = await readMultipart(request);
    const accent = form.get("accent");
    return {
      html: String(form.get("html") ?? ""),
      accent: typeof accent === "string" && accent !== "" ? accent : null,
    };
  }
  return readJsonBody(request);
}
