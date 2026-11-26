# Setup app list-view correction — 26 November 2026

## Reported problem and diagnosis

The Notification Profiles page raised `Cannot read properties of undefined (reading 'getNamedItem')` in the Power Apps client's `_GetFetchXml` / `_CreateQuery` path.

Published Dataverse readback in **Abhinav Research** showed an editor attribution XML comment before the `<fetch>` and `<grid>` roots of each of the three custom Setup app public views. PowerShell XML inspection confirmed the first node was a Comment, which has no attributes; removing the prefix leaves an Element first. This matches the reported client failure. The server accepts both forms of XML, so a successful server query alone does not confirm the browser fix.

## Applied configuration change

| View | Existing savedquery ID | Table |
|---|---|---|
| Notification Profiles | `30e97c2e-96b8-4c5c-b5e2-4c5c5fd6927b` | `abhi_deploymentprofile` |
| Deployment Events | `4a066f0c-2eb2-49bf-8958-865b983ec9b6` | `abhi_deploymentevent` |
| Dependency Decisions | `23745c58-4aa5-4acb-929c-cd96b0dbfc5d` | `abhi_deploymentdecision` |

Removed only leading XML comments/whitespace from `fetchxml` and `layoutxml`. Preserved the existing view IDs, names, table prefixes, filters, ordering, columns, primary IDs and object type codes. The profile table metadata confirmed object type code `11618`, primary ID `abhi_deploymentprofileid`, primary name `abhi_name` and an unmanaged customizable table.

Used Dataverse MCP `update_record` on `savedqueries`, followed sequentially by `publish_table` for each affected table. The first readback before publication still returned the old published definition; the post-publication readback returned the corrected XML. No publish-all operation was used. No desktop code, forms, flow definitions, connection references, approvals, permissions or profile values were changed by this repair.

## Validation performed

- All six XML fields parse before and after removal. The before/after `DocumentElement.OuterXml` values were identical, demonstrating that only the leading comments changed.
- All three published view readbacks exactly matched the intended corrected XML, starting with `<fetch>` and `<grid>`.
- Dataverse MCP `execute_fetchxml` succeeded for all three corrected queries with `top: 1`: one profile row; no event or decision rows. Business record contents were not copied to this evidence file.
- Latest profile readback: `default` **enabled**, trusted `abhi_flowuserid` **null**. The enablement was observed, not changed by this repair. The trusted identity and permission prerequisites remain outstanding (D03/D04 in the existing approval notes).
- `git diff --check` passed for tracked changes, with existing LF/CRLF notices. The newly added evidence/snapshot files are untracked and are outside that command's default scope.

Browser inspection remains unavailable: the in-app tab interface reports no local browser access, and native Edge inspection was stopped by URL verification. A fresh browser reload and opening the profile record are therefore still required host checks (D06). No live notification, approval, source mutation or deployment retry was performed.

No new testable business logic was added. No business tests, renderer build, packaging, solution checker or managed release ran for this metadata correction. Changed-code coverage and checker tooling remain the existing D07 gap; no coverage percentage or release approval is claimed. The full `docs/standards.md` and applicable `AGENTS.md` are absent (existing D01).

## Reproduction and deployment guidance

The canonical generated XML in `platform/setup-components.json` already starts with the root elements, and `platform/build-setup.cjs` generates no attribution comments. For future view changes, retain attribution in repository history/documentation rather than prepending an XML comment to the stored view fields. Use the generic record update path and verify published readback; an editor or helper that introduces a prefix can recreate this issue.

This correction is applied only to the existing unmanaged Abhinav Research setup. Export and validate an updated managed solution before promotion to another environment; no downstream artifact was produced. Refresh the Setup app using `Ctrl+Shift+R`, then open Notification Profiles and the existing default record. The verified trusted flow user and reviewed effective permissions are still needed for dependency repair approvals.

## Recovery

`platform/setup-views-before-comment-fix.json` preserves the three view IDs and their original XML. If restoration is required, update only `fetchxml` / `layoutxml` on those existing records from that snapshot, then publish each named table and verify readback. Restoring the original prefix also restores the suspected browser failure. Recovery has been recorded but not exercised. Required non-author review remains outstanding; no self-approval or exception is granted (STD-02 / REL-01 from the supplied working guidance).
