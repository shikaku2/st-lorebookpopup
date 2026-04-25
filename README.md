# Lorebook Popup

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that shows a toast notification whenever lorebook entries are injected into the prompt, with a full log and modal viewer.

## Features

- **Toast notification** — fires on each generation where one or more lorebook entries are active, showing the count: `Lorebook Entries Inserted: N`
- **Click-to-view** — clicking the toast opens a modal with the full text of every injected entry (optional, on by default)
- **Activation log** — keeps a rolling history of the last 10 generations that triggered lorebook entries, each showing entry titles, source book, and a content preview
- **Modal viewer** — view the complete injected text for any logged activation, accessible from the toast, per-row View buttons, or the View Latest button in the settings panel

## Installation

1. In SillyTavern, open **Extensions → Install extension**
2. Paste the repo URL and click Install

Or manually clone into your ST extensions folder:

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/shikaku2/st-lorebookpopup
```

Then reload SillyTavern.

## Settings

All settings are in the **Extensions** tab under **Lorebook Popup**.

| Setting | Default | Description |
|---|---|---|
| Enable toast notifications | On | Show a toast each time lorebook entries are injected |
| Click toast to view injected prompts | On | Makes the toast clickable — opens a full-text modal for that activation |
| Log inserted entries | On | Keep a rolling log of the last 10 activations in the settings panel |

The **View Latest** button and per-row **View** buttons open the same modal regardless of the clickable toast setting.

## Requirements

- SillyTavern 1.12.0 or later
