# Backlog

Ideas to build later. Nothing here is implemented yet. Finish the current phases in `AGENTS.md` first.

## 1. Daily speaking practice text

Show a new short passage every day to read aloud, for practising talking with my upper teeth.

- One passage per day, the same all day. Pick it by date (Toronto time) so it doesn't change on refresh.
- Probably a card on the Today page, with a "Done" tick that counts toward a streak like the other habits.
- Open questions:
  - Where the text comes from: a built-in list of passages, public-domain excerpts, or generated text. Generated text would need the `ANTHROPIC_API_KEY` from phase 4.
  - Length: a sentence, a paragraph, or a few paragraphs.
  - Whether passages should be chosen for particular sounds (for example lots of s, f, v or th) or be any random text.

## 2. Backend roadmap checklist

Put the backend roadmap from https://roadmap.sh/backend into the app as a checklist I work through one item at a time.

- Show the topics in roadmap order, grouped by section, each with a checkbox.
- Show progress (for example "23 / 140 done") and highlight the next unchecked topic.
- Probably a section on the Goals page, next to applications and milestones.
- Store progress in a new table. New tables need `ENABLE ROW LEVEL SECURITY` in a custom migration (see Gotchas in `AGENTS.md`).
- Open questions:
  - How to get the topic list: copy it by hand once, or import it from roadmap.sh's public GitHub repo (`kamranahmedse/developer-roadmap`). Check that repo's license before copying content in.
  - Whether to link each topic back to its roadmap.sh page for the resources.
  - Whether to track only done/not done, or also "in progress" and notes.
