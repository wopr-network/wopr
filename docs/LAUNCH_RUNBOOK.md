# Launch Runbook — April 1, 2026

This is the operational playbook for the WOPR launch drop. All channels go live within the same hour. This is not a campaign — it is a moment.

**Related docs:** `LAUNCH_TWITTER_PLAN.md` (pre-launch teaser schedule), `BRAND_VOICE.md` (tone guide)

---

## Prerequisites Checklist (verify before April 1 — do NOT launch if any fails)

- [ ] `wopr.bot` landing page loads in <2s, responsive, tested on mobile and desktop
- [ ] Signup flow works end-to-end: landing page → signup → onboarding → bot created → dashboard
- [ ] Payment flow works: Stripe checkout completes, credits granted, bot activates
- [ ] Platform stability: at least 48 hours of zero downtime before drop
- [ ] At least one real bot running as proof (maker's own bot, demo-able)
- [ ] Twitter/X account created, bio set, 3-week teaser tweets posted (per `LAUNCH_TWITTER_PLAN.md`)
- [ ] ProductHunt maker account created, product draft saved (not submitted)
- [ ] HN account logged in and ready (use an established account if possible — new accounts may be flagged)
- [ ] Discord `#announcements` channel ready, bot has permission to post
- [ ] Monitoring active: error tracking, uptime monitoring, signup funnel metrics

---

## Channel Copy (exact — do not edit)

### Hacker News

- **Title:** `What would you do with unlimited computing power for $5 a month?`
- **URL:** `https://wopr.bot`
- **Text field:** Leave empty. URL submission, not text post. The title is the pitch.

### Twitter/X

```
What would you do with unlimited computing power for $5 a month? wopr.bot
```

No hashtags. No emojis. No thread. Pin the tweet immediately after posting.

### ProductHunt

- **Product name:** WOPR Bot
- **Tagline:** `Your own supercomputer. $5/month.`
- **Description:** What would you do with unlimited computing power? Your WOPR Bot runs 24/7, never sleeps, never quits. One bot. One price. No tiers, no gotchas. wopr.bot
- **Website:** `https://wopr.bot`
- **Pricing:** $5/month (select "Paid")
- **Topics:** Artificial Intelligence, Developer Tools, Productivity, SaaS
- **Thumbnail:** Black background, green monospace "WOPR" text (match terminal aesthetic)
- **Gallery images (3 max):** (1) landing page terminal screenshot, (2) dashboard with running bot, (3) cost comparison ($500K team vs $5 WOPR Bot)
- **Maker comment (post immediately after listing goes live):** `I built a company overnight. My bot runs it. AMA.`

### Discord (WOPR server)

```
It's live. wopr.bot. $5/month. Your own WOPR Bot.

What would you do with unlimited computing power?
```

### Discord (external communities — adapt per community norms)

```
Hey — built something I'm pretty proud of. Your own AI bot that runs 24/7 for $5/month. No tiers, no gotchas. wopr.bot

Happy to answer questions.
```

Post only in communities where you are an active member. One message per community, no follow-ups unless asked. Use `#self-promotion` or `#showcase` channels if available.

---

## Execution Sequence (April 1, 2026)

All channels go live in the same hour. HN traffic peaks 8–10 AM ET. ProductHunt resets at midnight PT.

| Time | Action |
|------|--------|
| **3:01 AM ET (12:01 AM PT)** | Submit ProductHunt listing |
| **8:00 AM ET** | Submit Hacker News post |
| **8:00 AM ET** | Post Twitter/X launch tweet |
| **8:05 AM ET** | Pin tweet to profile |
| **8:05 AM ET** | Post ProductHunt maker comment |
| **8:10 AM ET** | Post Discord announcements (own server first, then external communities) |

**ProductHunt note:** PH daily ranking resets at midnight PT. Submit as close to 12:01 AM PT as possible so the listing accumulates upvotes before the HN and Twitter pushes at 8 AM ET.

---

## Monitoring (April 1, all day)

| Channel | Watch For | How to Respond |
|---------|-----------|----------------|
| HN | Comments, flagging, ranking | Answer technical questions directly. Don't argue with skeptics. If flagged, do NOT resubmit. |
| Twitter | Replies, quote tweets, shares | Like and reply to genuine engagement. Don't engage trolls. |
| ProductHunt | Upvotes, reviews, questions | Answer every question in maker comments. Thank reviewers. |
| Discord | Questions, new members, feedback | Welcome people, answer questions, direct to docs. |
| Platform | Error rates, signup completion, payment success | If it goes down, post "We're on it" on Discord only. Fix it. When back: "Back. Sorry about that." |

**Do NOT:**
- Ask friends to upvote the HN post (HN detects and penalizes)
- Post multiple tweets or threads on launch day — one tweet only
- Reply to every HN comment — pick the good questions
- Post "We're #1 on ProductHunt!" — let others say it

---

## Success Metrics (check April 2)

- [ ] HN post stayed on front page 4+ hours
- [ ] Launch tweet screenshotted and shared by someone who isn't us
- [ ] Discord server grew organically from signups
- [ ] At least one "shut up and take my $5" comment somewhere
- [ ] All channels went live within the same hour

Additional metrics to record:
- Total signups on April 1
- Signup-to-paid conversion rate
- Platform uptime during drop window
- ProductHunt final ranking for the day
- Twitter impressions / engagement on pinned tweet
