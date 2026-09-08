# Manual test checklist — run before every release

For each provider (Gemini free-tier key, OpenAI, Anthropic):

- [ ] `npx fypgen` boots and opens the browser
- [ ] Onboarding: wrong key shows the provider's real error message
- [ ] Onboarding: valid key advances to project setup
- [ ] Project setup rejects an empty topic with a visible message
- [ ] Outline: generates in < 60s, JSON parses, all 5 chapters present
- [ ] Outline: edit heading, remove section, add section, regenerate — all persist after tab close + relaunch
- [ ] Chapters: "Generate" streams visibly; "Generate all" runs sequentially
- [ ] Chapters: kill the network mid-stream → partial text kept → Continue completes the chapter
- [ ] Chapters: Regenerate with a nudge changes the output
- [ ] Review: inline edits persist; word counts are correct
- [ ] DOCX: downloads, opens in Word — title page fields, double spacing, TNR 12, justified, CHAPTER headings, References + verify label
- [ ] PPTX: downloads, opens in PowerPoint — ~10+ slides, Q&A appendix present
- [ ] Reset: "reset" link clears the project but keeps the API key
- [ ] localStorage: close the tab mid-flow, relaunch fypgen — same state restored
