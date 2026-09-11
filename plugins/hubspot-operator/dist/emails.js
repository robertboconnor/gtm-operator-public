import { hubspotRequest } from "./hubspot.js";
import { makeEnvelope, normalizeText } from "./utils.js";
/**
 * Pages the whole marketing-email catalogue and filters locally.
 *
 * HubSpot's list endpoint has no name filter, so any client that filters a single page
 * will miss anything older than that page — which is how a search returns nothing in a
 * portal that demonstrably holds dozens of matches. Page first, then match.
 */
async function fetchAllEmails(maxPages = 100) {
    const collected = [];
    let after;
    for (let page = 0; page < maxPages; page += 1) {
        const query = new URLSearchParams({ limit: "100" });
        if (after) {
            query.set("after", after);
        }
        const response = await hubspotRequest(`/marketing/v3/emails?${query}`);
        const results = response.results ?? [];
        collected.push(...results);
        after = response.paging?.next?.after;
        if (!after || results.length === 0) {
            break;
        }
    }
    return collected;
}
export async function marketingEmailsSearch(input) {
    const operation = "marketing_emails.search";
    const all = await fetchAllEmails();
    let matches = all;
    if (input.exactName) {
        const target = normalizeText(input.exactName);
        matches = matches.filter((email) => email.name && normalizeText(email.name) === target);
    }
    else if (input.name) {
        const target = normalizeText(input.name);
        matches = matches.filter((email) => email.name?.toLowerCase().includes(target));
    }
    if (input.state) {
        const target = normalizeText(input.state);
        matches = matches.filter((email) => email.state && normalizeText(email.state) === target);
    }
    return makeEnvelope(operation, { attempted: true, verified: true, targetType: "marketing_email" }, {
        scanned: all.length,
        count: matches.length,
        emails: matches.slice(0, input.limit ?? 50).map((email) => ({
            id: email.id,
            name: email.name,
            subject: email.subject,
            state: email.state,
            type: email.type,
            publishDate: email.publishDate,
        })),
    });
}
