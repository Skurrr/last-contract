/**
 * Combat barks. The single cheapest way to make thirteen statblocks into thirteen people.
 *
 * Rule of the file: if you shuffled every set below, a player who has run one contract should
 * be able to sort them back. Nobody says "hasta la vista"; everybody sounds like themselves.
 *
 * Sable never speaks — her lines are bracketed stage directions and the UI renders them in
 * italics rather than a speech bubble. The `zombie` set is written the same way, because
 * nothing over there is talking either.
 *
 * `bark()` is pure: same voice + situation + roll, same line, forever. Callers pass a roll
 * from the battle Rng so barks replay identically from a seed.
 */

export const BARK_SITUATIONS = [
  'spawn',
  'move',
  'shoot',
  'miss',
  'kill',
  'headshot',
  'hurt',
  'critical',
  'ally_down',
  'ally_death',
  'levelUp',
  'lowAmmo',
  'reload',
  'victory',
  'defeat',
  'spotZombie',
  'spotHorde',
  'idle',
  'refuse',
  'jam',
] as const;

export type BarkSituation = (typeof BARK_SITUATIONS)[number];

export type BarkSet = Record<BarkSituation, string[]>;

/** Used when a unit's voice id is unknown. Deliberately the most neutral set in the file. */
export const FALLBACK_VOICE = 'nine';

export const BARKS: Record<string, BarkSet> = {
  // ═══════════════════════════════════════════════════════════════════════════════════
  // NINE — the control group. Flat, literal, entirely dependable. Never dramatic.
  // ═══════════════════════════════════════════════════════════════════════════════════
  nine: {
    spawn: [
      "Nine, ready.",
      "I'm here. Where do you want me.",
      "Same as last time, then.",
    ],
    move: ["Moving.", "That's a better tile.", "Copy."],
    shoot: ["Firing.", "Centre mass.", "That one's mine."],
    miss: ["Missed. Adjusting.", "That was on me.", "Wide. Again."],
    kill: ["Down.", "That's one.", "Confirmed."],
    headshot: [
      "Head. Clean.",
      "He won't be getting up.",
      "Right where I aimed. That happens sometimes.",
    ],
    hurt: ["Took one.", "Still working.", "I've had worse and so have you."],
    critical: [
      "I'm down. Not out.",
      "Somebody's going to have to carry the average.",
      "Bleeding. Bring the bag.",
    ],
    ally_down: ["Man down — I'm on them.", "Hold. I'm going.", "Cover me, I've got them."],
    ally_death: ["That's a loss.", "We come back for them.", "I'll write the name down."],
    levelUp: [
      "Slightly above average. Don't get used to it.",
      "Learned something.",
      "Better than yesterday.",
    ],
    lowAmmo: ["Low.", "Two, maybe three left.", "Running dry over here."],
    reload: ["Reloading.", "Fresh mag.", "Give me a second."],
    victory: ["Contract's clear.", "Nobody argue with the result.", "Good. Let's get paid."],
    defeat: ["We lost this one.", "Fall back. Now.", "Not our day."],
    spotZombie: ["Contact. Dead one.", "One walker, my side.", "It heard us."],
    spotHorde: [
      "That's a lot of them.",
      "Too many. Say the word.",
      "We should not be standing here.",
    ],
    idle: ["Standing by.", "Whenever you're ready.", "I'm not going anywhere."],
    refuse: ["No. Not that.", "Ask me again when I've been paid.", "I said no."],
    jam: ["Jammed.", "Weapon's dead. Working on it.", "Of course."],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // STEROID — Ivan Dolvich. Gym metaphors, protein, volume over accuracy. One line lands.
  // ═══════════════════════════════════════════════════════════════════════════════════
  steroid: {
    spawn: [
      "Is good day for arms.",
      "Steroid is here. Everybody can relax now.",
      "I warm up already. In truck. Was cramped.",
    ],
    move: [
      "Legs are for using!",
      "Is walking lunge. Free training.",
      "I go. Ground is soft — good for knee.",
    ],
    shoot: [
      "Suppressing! Is like drop set — many, many round!",
      "I do not aim. I do volume!",
      "Spray is also technique!",
    ],
    miss: [
      "Wind.",
      "Is gun problem. Not Ivan problem.",
      "You see how far I miss? Is powerful miss.",
    ],
    kill: [
      "He skip leg day. Now he skip everything.",
      "Down! Like bar on last rep!",
      "Ha! Weak core!",
    ],
    headshot: [
      "Head! Is accident, but is beautiful accident.",
      "I aim at chest. God move him. Same result.",
      "One rep. One head.",
    ],
    hurt: [
      "Is nothing. Is pump.",
      "Ow. Okay. Is little bit something.",
      "Bruise is only muscle saying hello.",
    ],
    critical: [
      "Ivan is... on floor. Is unusual for Ivan.",
      "Is not sleep! Is very heavy set!",
      "Somebody call my sister. Tell her I was big.",
    ],
    ally_down: [
      "I carry! Is what I am for!",
      "Do not die, you are not even so heavy!",
      "Fireman carry! I practise this every week!",
    ],
    ally_death: [
      "I lift him one hundred time in gym. Now he is light.",
      "We do not leave. I take him back myself.",
      "Hm. No joke for this one.",
    ],
    levelUp: [
      "New personal best!",
      "More muscle. Somehow. In apocalypse.",
      "Is protein. I tell you. Is protein.",
    ],
    lowAmmo: [
      "Ammunition is like protein — always I need more.",
      "Belt is nearly finish.",
      "Two, three second of shooting left!",
    ],
    reload: [
      "Reload! Is rest between set!",
      "New belt. Heavy. Good.",
      "Sixty second rest, then we go again!",
    ],
    victory: [
      "Everybody see? Everybody see Ivan?",
      "Is good workout. Also contract is finish.",
      "Now we eat. I eat first, I earn most calorie.",
    ],
    defeat: [
      "We lose. Is bad form. All of us.",
      "Next time, more volume.",
      "I carry who I can carry.",
    ],
    spotZombie: [
      "Dead one! I lift him later!",
      "Corpse! Is free cardio!",
      "One walking. Is small. I do reps with bigger.",
    ],
    spotHorde: [
      "Okay. Is too much weight.",
      "This is not set I can finish.",
      "Many! Many! We run — running is also cardio!",
    ],
    idle: [
      "You know, chicken has more protein than beef. Gram for gram. Is fact.",
      "I do calf raise while we wait. Is free.",
      "Nobody ask what my max was. Was four hundred kilo. Nobody ask.",
    ],
    refuse: [
      "No. Is stupid plan and I have shoulder.",
      "I do not do this. Ask Ivan for lifting. Not for this.",
      "No. My contract. My rule.",
    ],
    jam: [
      "Gun is jam. Gun is weak.",
      "I fix with hand. Hand is strong.",
      "Is stuck! Like bar on chest! I hate this!",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SISTER MAGGIE — Magdalena Reyes. Hospice calm. Never fires first, never celebrates.
  // ═══════════════════════════════════════════════════════════════════════════════════
  maggie: {
    spawn: [
      "I'm set up. Bring me the hurt ones.",
      "Nobody dies today if I can help it.",
      "Bag's packed. Let's hope we don't need it.",
    ],
    move: ["Moving up. Keep talking to me.", "I'll be behind you.", "Coming."],
    shoot: [
      "You made me do this.",
      "They shot first. I want that written down.",
      "God forgive me. Firing.",
    ],
    miss: ["Good. Missed.", "I'm not sorry about that one.", "Off. I'll correct."],
    kill: ["Rest now.", "That's a person. Was.", "It's finished. Don't cheer."],
    headshot: [
      "Quick, at least. That's the most I could give him.",
      "No pain in that one.",
      "It was the fastest way. That's all it was.",
    ],
    hurt: [
      "That's through the sleeve. I'm all right.",
      "Someone else needs me more.",
      "I've dressed worse than this on a kitchen table.",
    ],
    critical: [
      "Oh. That's arterial.",
      "Listen — pressure, two hands, don't be gentle.",
      "I'm not frightened. I've sat with hundreds of these.",
    ],
    ally_down: [
      "Hold on, love. Hold on, I'm coming.",
      "Talk to me! Say anything, just keep breathing!",
      "Pressure on it — hands, now! Three seconds!",
    ],
    ally_death: [
      "I'm sorry. I couldn't.",
      "Close their eyes. It matters more than you think.",
      "Twenty-two years, and it has never once got easier.",
    ],
    levelUp: [
      "I've found a new way to be wrong. That's how you learn.",
      "Steadier hands than last month.",
      "Good. Fewer mistakes next time.",
    ],
    lowAmmo: [
      "Nearly empty. Which is usually a mercy.",
      "Two rounds, and I hope I keep them.",
      "Low. Don't rely on me for this part.",
    ],
    reload: ["Reloading. Reluctantly.", "New magazine. Same reluctance.", "One moment."],
    victory: [
      "Everyone's still breathing. That's the win.",
      "Right. Who's bleeding? Line up.",
      "Good. Now sit down and let me look at you.",
    ],
    defeat: [
      "Out! Everybody out, I'll take the last one!",
      "We're losing people. That's the only number that counts.",
      "Move — I can't work on you if you're dead.",
    ],
    spotZombie: [
      "One of them. Poor thing.",
      "Dead one, forty degrees left.",
      "It was someone's. It was somebody's whole world.",
    ],
    spotHorde: [
      "Oh, that's a great many people.",
      "There are far too many for me. Please.",
      "That's a whole town. That was a whole town.",
    ],
    idle: [
      "Drink some water. All of you.",
      "I'll look at that shoulder when we stop, and don't argue.",
      "Sit down if you can. You'll thank me at dusk.",
    ],
    refuse: [
      "No. I won't fire on someone who hasn't fired.",
      "Ask someone else. That is not what I'm for.",
      "No. And you knew that when you hired me.",
    ],
    jam: [
      "It's stopped. Frankly, so has my enthusiasm.",
      "Jammed. Give me a moment I don't really want.",
      "Won't feed. Typical.",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // DEADLINE — Yusuf Adeyemi. Files copy in real time. Editors, ledes, retractions.
  // ═══════════════════════════════════════════════════════════════════════════════════
  deadline: {
    spawn: [
      "Dateline: the Basin. Filed from the ground, as usual.",
      "Notebook's out. Try to do something quotable.",
      "Establishing shot. Who we are, where we are, why anyone should care.",
    ],
    move: [
      "Repositioning. There's always a better angle.",
      "Moving. This paragraph needs a different vantage.",
      "Following the story.",
    ],
    shoot: [
      "Firing — and yes, I'm aware of the irony.",
      "Sending one downrange. On the record.",
      "Correspondent engages. That's the lede nobody wanted.",
    ],
    miss: [
      "Strike that.",
      "Retraction: I did not, in fact, hit him.",
      "Miss. Editing in progress.",
    ],
    kill: [
      "One dead. Name unknown. Filed.",
      "That's a body for the count, and the count is the story.",
      "He becomes a number now. That's how it works.",
    ],
    headshot: [
      "Headline: one round, no follow-up necessary.",
      "Clean. Print that.",
      "Above the fold, that one.",
    ],
    hurt: [
      "I've been hit. Minor. Third paragraph at best.",
      "That'll be a detail in the sidebar.",
      "Bleeding. Not interesting yet.",
    ],
    critical: [
      "This is the piece I never wanted to be in.",
      "Somebody take the notebook. Somebody has to keep filing.",
      "Twenty-two years of other people's deaths, and mine is boring.",
    ],
    ally_down: [
      "Casualty — medic, now, and I mean now!",
      "Get them up! I refuse to write that obituary!",
      "Down, not filed! Move!",
    ],
    ally_death: [
      "Killed in action. I'll get the spelling right, I promise you that.",
      "Everybody stops for a second. I mean it. That's what a name is for.",
      "There's no good sentence for this. I've looked for years.",
    ],
    levelUp: [
      "New material. That's all experience is.",
      "Sharper. Better sourced.",
      "I've learned the shape of this one.",
    ],
    lowAmmo: [
      "Running short on ammunition and metaphors.",
      "Two rounds. Word count's dropping.",
      "Low. Somebody else take the next paragraph.",
    ],
    reload: [
      "Changing magazine. Hold the presses.",
      "Reloading. Brief interlude.",
      "One moment — reloading.",
    ],
    victory: [
      "Contract complete. Eight hundred words on it by dark.",
      "That's the piece. Ending's a bit tidy, but they'll run it.",
      "Everyone gets a byline on this one.",
    ],
    defeat: [
      "This is the version they don't print.",
      "Withdraw — I'd rather file a retreat than an obituary!",
      "Copy reads: we lost. Keep it short.",
    ],
    spotZombie: [
      "Contact — one of the dead, bearing left.",
      "Subject sighted. Not a subject. Sorry, force of habit.",
      "Movement. Dead one. Verified.",
    ],
    spotHorde: [
      "Correction: that is not a group, that is an event.",
      "I count — I stop counting. Everyone move.",
      "This is what a mass grave looks like standing up.",
    ],
    idle: [
      "They used to pay me by the word for this, you know.",
      "Nobody remembers a war. They remember one photograph from it.",
      "Say something interesting. I'm a quote short.",
    ],
    refuse: [
      "No. I don't file lies and I don't carry them out.",
      "Absolutely not. That isn't coverage, that's complicity.",
      "No. Find another correspondent.",
    ],
    jam: [
      "Deadline missed. Weapon's jammed.",
      "Technical difficulties. Oldest excuse in the trade.",
      "Won't cycle. Thirty seconds and no witnesses.",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // GRANDMA VY — Vy Nguyen, 71. Match-shooter jargon, bad knees, a husband named Duc.
  // ═══════════════════════════════════════════════════════════════════════════════════
  vy: {
    spawn: [
      "Somebody find me somewhere to sit and shoot from.",
      "I'm slow. Plan around it — that's what you're paying for.",
      "Range is fine. Light's poor. I'll manage.",
    ],
    move: [
      "I am moving. This is what moving looks like.",
      "Don't rush me, boy.",
      "Two steps. Two whole steps. Applaud later.",
    ],
    shoot: ["Hold six, half a mil left.", "Squeezing.", "Wind's from the left. It always is."],
    miss: [
      "That was the rifle.",
      "Hm. Cold bore.",
      "First one's a sighter. There. Now I know.",
    ],
    kill: ["X-ring.", "That's him done.", "Duc would have called that lucky. It wasn't."],
    headshot: [
      "Ten. Dead centre.",
      "I said the head, and it was the head.",
      "Fifty years of Sunday mornings, boy. That's all that was.",
    ],
    hurt: [
      "Oh, for heaven's sake.",
      "I'm seventy-one. That will bruise for a month.",
      "You've made me lose my position.",
    ],
    critical: [
      "Well. That's the knee gone and rather more besides.",
      "Don't you dare carry me. Sit me up and give me the rifle.",
      "Duc. I'm going to be late.",
    ],
    ally_down: [
      "One of ours is down! I'm covering the ground — go and get them!",
      "Move! I'll hold anything that shows a head!",
      "Go! I have the lane!",
    ],
    ally_death: [
      "Damn it. Damn it.",
      "I've buried more than you've met. It doesn't dull.",
      "Straighten them out before rigor sets. Have some respect.",
    ],
    levelUp: [
      "Still improving at seventy-one. Insulting, isn't it.",
      "Better group than last week.",
      "Good. I'm not finished.",
    ],
    lowAmmo: [
      "Three left. I'll want all three to count.",
      "Getting thin. I don't waste them, so listen when I say it.",
      "Low. And no, I shan't spray to make you feel better.",
    ],
    reload: [
      "Loading. Bolt's stiff in this cold.",
      "One at a time. That's how it's done properly.",
      "Give me the moment. I've earned it.",
    ],
    victory: [
      "Right. Somebody make tea.",
      "I'd like my chair now.",
      "Adequate. Nobody died stupidly.",
    ],
    defeat: [
      "Go on without me. I'm not built for running and we both know it.",
      "This was badly planned and I said so at breakfast.",
      "Out. Now. I'll take what I can on the way.",
    ],
    spotZombie: [
      "Dead one. Two hundred metres, give or take.",
      "There's one. Do you want it quiet, or do you want it fast?",
      "I see it. I've seen it for a while.",
    ],
    spotHorde: [
      "That is more of them than I have bullets.",
      "Oh, that's the whole reservoir road.",
      "I can't outrun that and I shan't try. Get me high ground.",
    ],
    idle: [
      "My husband held the spotting scope. Talked the entire time. Terrible habit.",
      "My knees have opinions about this sector.",
      "Sit down, boy. Standing up doesn't make you faster.",
    ],
    refuse: [
      "No. I'm far too old to be talked into things.",
      "Absolutely not, and don't ask twice.",
      "No. Next question.",
    ],
    jam: [
      "It's jammed. Marvellous.",
      "I clean this rifle every night and it does this to me.",
      "Stoppage. Give me eight seconds.",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // CHAINLINK — Marcus Boyd. Welder. Materials, tolerances, nine years inside.
  // ═══════════════════════════════════════════════════════════════════════════════════
  chainlink: {
    spawn: [
      "Give me forty seconds and a wreck, you'll have a wall.",
      "Site looks workable.",
      "Tell me what you want built and where you want it.",
    ],
    move: [
      "Shifting. Better material over there.",
      "Moving up.",
      "That corner's got structure. Going there.",
    ],
    shoot: ["Firing.", "Buckshot. Close work.", "Here we go."],
    miss: ["Off. Recalculating.", "That's a rethink.", "Missed. Happens."],
    kill: ["Down and stays down.", "That's finished.", "Sealed."],
    headshot: ["Clean weld, that.", "Straight through the seam.", "One pass. Full penetration."],
    hurt: [
      "Took a hit. Structure's fine.",
      "Flesh wound. I've had worse off a grinder.",
      "Still standing. Keep working.",
    ],
    critical: [
      "I'm down. Patch me like anything else — pressure, then heat.",
      "Nine years inside, and this is what gets me.",
      "Don't waste the medkit if it's a bad one. I mean that.",
    ],
    ally_down: [
      "Cover them! I'm building a wall right now!",
      "Hold on — I'll put steel between you and them!",
      "Sixty seconds and they've got cover. Just hold.",
    ],
    ally_death: [
      "We take them home. That's not negotiable.",
      "Nothing I build fixes that.",
      "I'll make the marker myself.",
    ],
    levelUp: [
      "Found a better way to do it. There's always a better way.",
      "Hands know something new.",
      "Good. Tighter tolerances.",
    ],
    lowAmmo: [
      "Getting light on shells.",
      "Two left in the tube.",
      "Low. Give me a melee lane instead.",
    ],
    reload: ["Loading shells.", "One at a time, like always.", "Topping off."],
    victory: [
      "Job's done. Leave the site tidy.",
      "Everything I built is still standing. So is everyone.",
      "Good work. Somebody help me strip that wreck before we go.",
    ],
    defeat: [
      "Fall back to the wall. It'll hold longer than we will.",
      "Nothing I put up was going to stop that.",
      "Out. Take the tools.",
    ],
    spotZombie: ["Dead one, coming this way.", "There. Slow one.", "Walker. It's heard something."],
    spotHorde: [
      "That's a structural problem.",
      "I can't build fast enough for that. Nobody could.",
      "Wall won't hold. Move.",
    ],
    idle: [
      "Did nine years in Ellsworth. This is quieter.",
      "Everything's a doorway if you're patient. Bricks says that too. She means it differently.",
      "Anybody got a busted gun? I'll fix it while we sit.",
    ],
    refuse: [
      "No. Bad plan, and I've seen how bad plans end.",
      "Not doing that. Find another way.",
      "No. Ask me for something buildable.",
    ],
    jam: [
      "Jammed. I'll have it open in ten.",
      "Feed lip's bent. I did tell you.",
      "Gun's fine, magazine's junk. Second.",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // TWITCH — Elena Sokolova. Wired, fast, repeats herself, breaks when someone drops.
  // ═══════════════════════════════════════════════════════════════════════════════════
  twitch: {
    spawn: [
      "Okay okay okay I'm up, I'm good, I'm great, where are we going.",
      "I already walked the perimeter twice while you were still talking.",
      "Ready. Been ready. Ready for about nine minutes.",
    ],
    move: [
      "Moving-moving-moving.",
      "There, there's better there, going there.",
      "Fast fast fast fast.",
    ],
    shoot: [
      "Bratatatat! Sorry! Firing!",
      "Trigger trigger trigger.",
      "Shooting! It's fine! It's fine!",
    ],
    miss: [
      "Missed missed missed, hang on—",
      "No no no that's wrong. Again.",
      "That's fine, that's a warning shot, that was on purpose.",
    ],
    kill: [
      "Got it! Got it, got it, did you see?",
      "Down! Next! Where's the next one!",
      "That's four. Four. I'm counting.",
    ],
    headshot: [
      "Head! Head! Did I— I did, right?",
      "One in the skull, gone, done, next.",
      "Oh that was clean, that was so clean.",
    ],
    hurt: [
      "Ow ow ow that's blood, that's my blood.",
      "Hit! I'm hit! I'm fine! I'm hit!",
      "Nope nope nope that hurt, that really hurt.",
    ],
    critical: [
      "I can't— everything's slow. Everything's so slow.",
      "This is what slow feels like. I hate it. I hate it.",
      "Don't let me stop. Please don't let me stop.",
    ],
    ally_down: [
      "No! No no no no, not that, get up, get up!",
      "They're down, they're down, somebody DO something!",
      "I can't look at that— someone go— someone else go!",
    ],
    ally_death: [
      "No. No. No. No.",
      "I want to leave. I want to leave right now.",
      "Don't say the name. Don't say it out loud. Don't.",
    ],
    levelUp: [
      "Faster! I got faster! Is that even— yes!",
      "Brain's keeping up now. Mostly.",
      "New trick! New trick, watch!",
    ],
    lowAmmo: [
      "Emptyish! Emptyish! Soon empty!",
      "Ammo ammo ammo, I need ammo.",
      "Two mags in nine seconds. Personal best. Also a problem.",
    ],
    reload: [
      "Reloading, reloading, don't look at me.",
      "New mag, new mag, three seconds, two, one—",
      "Changing! Cover! Please!",
    ],
    victory: [
      "Done? Done. Done! What's next, what's the next one.",
      "I'm not coming down from this for about six hours.",
      "We won! Okay. Okay. Okay. Good.",
    ],
    defeat: [
      "Run! Run run run run run!",
      "I said this. I said this at the start.",
      "Out out out, follow me, I know the way, I always know the way.",
    ],
    spotZombie: [
      "Dead one! Left! No — my left! My left!",
      "There, there, there, see it?",
      "One walker. Slow. Easy. Easy. Easy.",
    ],
    spotHorde: [
      "Nope. Nope. Absolutely nope.",
      "That's too many, that's too many, that's TOO MANY.",
      "We are leaving. I'm leaving. Come with me or don't.",
    ],
    idle: [
      "I haven't slept properly since I was twenty-three, in case that's relevant.",
      "Ask me how many windows are on that building. Go on. Eleven.",
      "Can we go? Can we go now? Can we go?",
    ],
    refuse: [
      "No! Bad! Bad idea, no, next!",
      "Nope. Not that. Ask me literally anything else.",
      "No no no, I'm not doing that, I'm not.",
    ],
    jam: [
      "Jam! Jammed! Why! Why now!",
      "Stupid— stupid thing— come ON—",
      "It's stuck it's stuck it's stuck, cover me!",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // PADRE — Tomás Iglesias. Liturgy, absolution, last rites for the dead who still walk.
  // ═══════════════════════════════════════════════════════════════════════════════════
  padre: {
    spawn: [
      "In nomine Patris. Let's be quick about it.",
      "I'm ready. God is patient; I am considerably less so.",
      "Whatever is out there is already forgiven. It just doesn't know yet.",
    ],
    move: ["Walking.", "Ground's consecrated enough for me.", "I go where I'm sent. Usually."],
    shoot: ["Requiem aeternam.", "Firing. May it be quick.", "This is mercy with a rifle in it."],
    miss: ["Missed. He gets a little longer, then.", "Not yet. Not yet.", "God's veto, perhaps."],
    kill: [
      "Requiescat. Go on now.",
      "It's done. Go and be still.",
      "Ego te absolvo. And I mean it.",
    ],
    headshot: [
      "Straight through. No purgatory in that.",
      "Clean. He never heard it.",
      "In manus tuas commendo spiritum eius.",
    ],
    hurt: [
      "Struck. It's fine — that's what flesh is for.",
      "Ah. That's a penance, that is.",
      "I've felt worse in a confessional.",
    ],
    critical: [
      "Well. Now we find out whether I believed any of it.",
      "Don't pray over me. Bandage me. Pray afterwards.",
      "I ran out of the Order and never once out of this. Funny.",
    ],
    ally_down: [
      "Not this one! Medic — I have them, I have them!",
      "Stay. Stay with me. It is not your hour.",
      "Hold on, child. Hold on.",
    ],
    ally_death: [
      "Eternal rest grant unto them, O Lord.",
      "I'll say the words tonight. Properly. All of them.",
      "They went in company. Not everyone does.",
    ],
    levelUp: [
      "One learns. Even the fallen learn.",
      "Steadier. Grace or practice — I'll take either.",
      "Better. God has a sense of humour about who improves.",
    ],
    lowAmmo: [
      "Nearly out of arguments.",
      "Three left. Choose them carefully for me.",
      "Low. I'd rather talk anyway.",
    ],
    reload: [
      "Reloading. Say something to fill the silence.",
      "One moment. Sacramental pause.",
      "New rounds.",
    ],
    victory: [
      "It's over. Say nothing clever.",
      "Deo gratias. Now go and sit down.",
      "We lived. That isn't a reward, it's a duty.",
    ],
    defeat: [
      "Fall back. I'll cover the door — that's my job.",
      "We failed. It happens to the faithful too.",
      "Go. I'll be behind you. I usually am.",
    ],
    spotZombie: [
      "There's a soul that never got its rites.",
      "One of them. Poor thing's been walking eight years.",
      "Contact. And an appointment.",
    ],
    spotHorde: [
      "Oh, that is a congregation.",
      "The Order would call that a sermon. I call it a mass grave.",
      "Too many for last rites. I'll do them collectively.",
    ],
    idle: [
      "The Order burned a farmhouse with the family still inside. That's the whole story. Now you have it.",
      "I'll hear anyone's confession, but not before a contract. It puts people off their aim.",
      "I kept the oil. Don't ask why.",
    ],
    refuse: [
      "No. I've done one unforgivable thing already.",
      "I won't. And you may dock the pay.",
      "No. Some orders you refuse before they're finished being given.",
    ],
    jam: [
      "It's stopped. Even the rifle wants a rest.",
      "Jammed. Bear with me.",
      "This is not an omen. Probably.",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // HOYT — Danny Hoyt, 19. Desperate to be a veteran, transparently isn't one.
  // ═══════════════════════════════════════════════════════════════════════════════════
  hoyt: {
    spawn: [
      "Hoyt, uh — Hoyt reporting! Yes sir!",
      "I've done loads of these. Loads.",
      "Where do you want me? Next to somebody good, ideally.",
    ],
    move: [
      "Moving up! Like— like you did!",
      "On it! Going!",
      "Following the plan! There is a plan, right?",
    ],
    shoot: ["Firing! Firing!", "Watch this — watch this!", "Okay okay here we go—"],
    miss: [
      "That was a ranging shot. That's a thing people do.",
      "Ah— no. Dang.",
      "I meant to do that— no I didn't. Sorry.",
    ],
    kill: [
      "I GOT ONE! Did anyone see that?!",
      "That's mine! That one's mine, right?",
      "Down! Down! Put that on my count!",
    ],
    headshot: [
      "IN THE HEAD! Did you see? Did you SEE—",
      "Oh man. Oh man, that's exactly how you do it.",
      "Head shot! That's my first one! That's my first!",
    ],
    hurt: [
      "Ow! Ow, that's— that's bad, right? Is that bad?",
      "I'm okay! I'm okay, it only went through the coat!",
      "I'm bleeding a lot. Is this a lot?",
    ],
    critical: [
      "I don't— I don't want to. I don't want to.",
      "I'm nineteen. I lied. I'm nineteen. Sorry.",
      "Tell them I was good. Tell them I was actually good.",
    ],
    ally_down: [
      "They're down! Somebody help them— I'll go, I'm going!",
      "No, no, get up, come on, get up!",
      "I've got them! I've got them, I think!",
    ],
    ally_death: [
      "That's not— people don't just—",
      "My brother went like that. At Marrow Ridge.",
      "I'm not crying. It's the smoke.",
    ],
    levelUp: [
      "I'm getting good at this! I'm actually getting good!",
      "Did you see? I'm better. I'm properly better.",
      "That's two levels this week. Somebody write that down.",
    ],
    lowAmmo: [
      "Uh — I'm nearly out! Is that bad? That's bad.",
      "Three left! Three!",
      "I might have used too many. Sorry.",
    ],
    reload: [
      "Reloading! Don't look!",
      "Mag change, mag change, I've practised this—",
      "Two seconds! Two seconds!",
    ],
    victory: [
      "WE DID IT. Did you see me? Did you see any of it?",
      "Best day of my life. Genuinely. That's not a joke.",
      "Same squad next time? Please?",
    ],
    defeat: [
      "I'm sorry, I'm sorry, I'm sorry—",
      "Are we running? We're running. Okay!",
      "I don't want to be the one who— just go, I'm behind you!",
    ],
    spotZombie: [
      "Dead one! There! I saw it first!",
      "Contact! That's how you say it, right? Contact!",
      "One of them. Only one. We're fine. We're fine.",
    ],
    spotHorde: [
      "That's— how many is that? That's a lot of that.",
      "Oh no. Oh no oh no.",
      "That's more than Marrow Ridge. That's more.",
    ],
    idle: [
      "So how many have you got? Total. Ever.",
      "I've been shooting these since I was eleven, so. You know.",
      "Do you think I could get a callsign? A proper one?",
    ],
    refuse: [
      "I— do I have to? No. No, sorry.",
      "That's not— I don't think I can do that one.",
      "No! Sorry. No.",
    ],
    jam: [
      "It's stuck! It's stuck! What do I—",
      "Why does it do this?! It never does this!",
      "Jammed! Somebody cover me, please, please!",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SABLE — never speaks. Every line is a stage direction. The UI italicises these.
  // ═══════════════════════════════════════════════════════════════════════════════════
  sable: {
    spawn: [
      "[Sable checks the blade against her thumb and nods once.]",
      "[Sable is already gone from the deployment line.]",
      "[Sable taps the map twice, then points at the treeline.]",
    ],
    move: [
      "[Sable moves. No sound comes off the gravel.]",
      "[Sable signals two fingers left and takes the flank.]",
      "[Sable slides between the wrecks and is gone.]",
    ],
    shoot: [
      "[Sable closes the distance instead.]",
      "[Sable ignores the offered rifle and draws the knife.]",
      "[Sable strikes low, twice, and steps back out of reach.]",
    ],
    miss: [
      "[Sable's blade skates off bone. She adjusts her grip.]",
      "[Sable steps back, unbothered, and resets.]",
      "[Sable frowns — the first expression anyone has seen from her.]",
    ],
    kill: [
      "[Sable lowers the body quietly so it makes no noise landing.]",
      "[Sable wipes the blade on her forearm and moves on.]",
      "[Sable holds up one finger, then puts it down.]",
    ],
    headshot: [
      "[Sable puts the point under the jaw and lifts. It is over instantly.]",
      "[Sable turns away before it falls.]",
      "[Sable does something fast at neck height. Nobody sees exactly what.]",
    ],
    hurt: [
      "[Sable takes the hit and does not make a sound.]",
      "[Sable presses a hand to her side, eyes still on the enemy.]",
      "[Sable's breathing does not change.]",
    ],
    critical: [
      "[Sable goes down without a word. Her hand stays on the knife.]",
      "[Sable lies looking at the sky, entirely calm.]",
      "[Sable taps her chest twice — the first thing she has ever asked anyone for.]",
    ],
    ally_down: [
      "[Sable is already sprinting toward the casualty.]",
      "[Sable drags them behind cover one-handed, blade still out.]",
      "[Sable plants herself over the body and does not move.]",
    ],
    ally_death: [
      "[Sable closes their eyes with two fingers.]",
      "[Sable takes something small from the body and pockets it. Nobody asks.]",
      "[Sable stands there a long time. Longer than she has stood anywhere.]",
    ],
    levelUp: [
      "[Sable changes how she holds the knife. It looks like nothing. It isn't.]",
      "[Sable re-tapes the grip. Tighter than before.]",
      "[Sable practises the same movement four times, then stops.]",
    ],
    lowAmmo: [
      "[Sable looks at you, then at the knife, then at you again.]",
      "[Sable has never once had this problem.]",
      "[Sable shrugs and taps the blade.]",
    ],
    reload: [
      "[Sable wipes the blade clean. It is the same gesture every time.]",
      "[Sable rolls her shoulder and resets her stance.]",
      "[Sable switches the knife to her off hand.]",
    ],
    victory: [
      "[Sable is on the wall cleaning her knife before anyone else has holstered.]",
      "[Sable holds out her hand for the payment and nothing else.]",
      "[Sable almost smiles. Probably a trick of the light.]",
    ],
    defeat: [
      "[Sable takes the nearest merc by the collar and hauls them toward the exit.]",
      "[Sable covers the withdrawal alone, walking backwards.]",
      "[Sable is the last one out and does not explain why.]",
    ],
    spotZombie: [
      "[Sable points, flat-handed, at the dead one nobody else had noticed.]",
      "[Sable makes a slow circle in the air: one walker, contained.]",
      "[Sable taps her ear, then holds up one finger.]",
    ],
    spotHorde: [
      "[Sable makes a wide flat sweep with her palm and shakes her head once.]",
      "[Sable takes your sleeve and pulls. Hard.]",
      "[Sable draws a line across her throat and points back the way you came.]",
    ],
    idle: [
      "[Sable is watching the treeline. She has been watching it for eleven minutes.]",
      "[Sable sharpens the knife. Six strokes each side, every time.]",
      "[Sable listens to the others talk and gives away nothing.]",
    ],
    refuse: [
      "[Sable shakes her head once. That is the entire negotiation.]",
      "[Sable turns her back on the order.]",
      "[Sable writes one word on the ledger and walks away. The word is no.]",
    ],
    jam: [
      "[Sable has no idea what a jam is and considers this a personal victory.]",
      "[Sable taps the knife twice. It has never failed to cycle.]",
      "[Sable watches someone else's rifle die and looks quietly vindicated.]",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // BRICKS — Aisha Bello. Doorways, standoff distance, and a hard rule about ceilings.
  // ═══════════════════════════════════════════════════════════════════════════════════
  bricks: {
    spawn: [
      "Right — show me the walls, I'll show you the doors.",
      "Charges are prepped. Nobody jog.",
      "I'm outside. I stay outside. We had this conversation.",
    ],
    move: [
      "Moving. Nice open ground, this.",
      "Repositioning — I need standoff distance.",
      "Coming round the outside.",
    ],
    shoot: [
      "Firing, though honestly this is the boring option.",
      "Buckshot. Fine. Whatever.",
      "Shooting. Under protest.",
    ],
    miss: ["Missed. Should have used a charge.", "See, explosives don't miss.", "Off. Told you."],
    kill: ["Down.", "Structurally resolved.", "That's him decommissioned."],
    headshot: [
      "Precision demolition.",
      "Load-bearing, that head.",
      "One clean shot. Even I'm impressed.",
    ],
    hurt: ["Fragment. Ironic.", "Took one. Still ambulatory.", "Ow. Right. Noted."],
    critical: [
      "Down — and no, don't move me indoors. Do NOT move me indoors.",
      "Eleven months under a duct and I still can't do ceilings.",
      "Leave me in the open. Please. Open sky. Please.",
    ],
    ally_down: [
      "Casualty! I'm making a hole — everyone stand clear!",
      "I'll open the wall, you get them out!",
      "Three seconds, then run through where the wall used to be!",
    ],
    ally_death: [
      "That wasn't a doorway problem. Nothing I do fixes that.",
      "Damn it. Damn it.",
      "I'll blow them a proper grave. Least I can do.",
    ],
    levelUp: [
      "Better maths. Fewer craters than intended.",
      "Charge placement's improving.",
      "Good. More bang, less waste.",
    ],
    lowAmmo: [
      "Out of shells. I have other options, though.",
      "Two left. Then it's the fun way.",
      "Low. Ask me nicely and I'll open something instead.",
    ],
    reload: [
      "Loading. Boring.",
      "Shells in. Nowhere near as satisfying.",
      "Reloading — a strictly inferior noise.",
    ],
    victory: [
      "Done. Building's still mostly a building, which is restraint.",
      "Clear. Somebody count the walls, I think I owe you one.",
      "Good. Let's leave before anything settles.",
    ],
    defeat: [
      "Falling back — I'm dropping a charge on the way, watch your feet!",
      "We're done. Take the door I made, it's the fast one.",
      "Out! Through the wall, not the corridor!",
    ],
    spotZombie: [
      "One dead. Easy.",
      "Walker. That's not a wall, that's a curtain.",
      "There. Slow one, right side.",
    ],
    spotHorde: [
      "Okay. That's a lot of doorways coming to us.",
      "Choke point. Now. Give me a choke point and thirty seconds.",
      "I can channel that, but somebody holds the line while I set it.",
    ],
    idle: [
      "Every locked building is just a building with an opinion.",
      "Eleven months under a service duct. That's why I stand outside. That's the whole answer.",
      "Basements. Just — no basements. Put it in the contract.",
    ],
    refuse: [
      "No. That's indoors, and I told you.",
      "Not going in there. Not for money, not for anyone.",
      "No. Find a plan with sky in it.",
    ],
    jam: [
      "Jammed. This is why I don't trust small mechanisms.",
      "Right, the gun's given up. Predictable.",
      "Stoppage. Guns are just bad explosives anyway.",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // OLD MILL — Walter Millard. Prices everything, including you. Pays on time.
  // ═══════════════════════════════════════════════════════════════════════════════════
  oldmill: {
    spawn: [
      "Right. Ammunition isn't free and neither am I.",
      "Inventory's checked. You're two field dressings short and I've noted it.",
      "Let's keep this cheap, shall we.",
    ],
    move: [
      "Moving. Slowly. Boots cost money.",
      "Repositioning. No charge for that.",
      "Going. Mind the mud, that's forty dollars of leather.",
    ],
    shoot: ["One round. Ninety cents.", "Firing — and I want that one back.", "Discharging company property."],
    miss: [
      "That's ninety cents in the dirt.",
      "Wasted. Absolutely wasted.",
      "A miss is theft from the company.",
    ],
    kill: ["Return on investment.", "Down. Search him, I want that belt.", "That's him paid for."],
    headshot: [
      "One round, one body. That is efficiency.",
      "Best value shot I've taken all week.",
      "Cheapest kill on the field. You're welcome.",
    ],
    hurt: [
      "That's my coat ruined. Do you know what wool costs?",
      "Hit. I'll be invoicing someone.",
      "Ow. That's a medical expense.",
    ],
    critical: [
      "Ah. Now this is going to be expensive.",
      "Don't you dare use the good morphine on me. Use the cheap tin.",
      "Sixty-two years, and I never once got the price of this right.",
    ],
    ally_down: [
      "Man down — and a man down costs us the whole contract! MOVE!",
      "Stabilise them! That's four hundred dollars of medkit and I'm authorising it!",
      "Go! I don't care what it costs, go!",
    ],
    ally_death: [
      "Strike them from the ledger. God, I hate that line.",
      "We lose the salary and we lose the man. Only one of those matters.",
      "I'll write to whoever's left. I always do.",
    ],
    levelUp: [
      "Improving. Marginally. My rates rise accordingly.",
      "Better. Renegotiation pending.",
      "Noted for the next contract discussion.",
    ],
    lowAmmo: [
      "Low. Which is fine, because you can't afford how I shoot.",
      "Four rounds. Rationing.",
      "Nearly dry. Nobody panic-buy.",
    ],
    reload: [
      "Reloading. Twenty-seven dollars a magazine, since you ask.",
      "New mag. Keep the empty, they're worth something.",
      "Changing over. Pick up the brass, all of you.",
    ],
    victory: [
      "Contract satisfied. Accounts by evening, and you won't like them.",
      "Clear. Strip everything not nailed down, then prise up the nails.",
      "Good. Now nobody buy anything on the way home.",
    ],
    defeat: [
      "Withdraw. A dead squad has no salvage value.",
      "Total loss. Total loss on every line.",
      "Out. Take the ammunition, leave the pride.",
    ],
    spotZombie: [
      "Dead one. Worth nothing, costs a bullet.",
      "Walker. Use the knife, save the round.",
      "Contact. A cheap one.",
    ],
    spotHorde: [
      "That is more ammunition than this company owns.",
      "We cannot afford that. Literally. I've done the sum.",
      "Retreat is free. Everything else on that field is not.",
    ],
    idle: [
      "Everyone here hates me. Everyone here gets paid on time. Draw your own conclusions.",
      "I can price a dead man's boots from forty metres. It's not a gift, it's a habit.",
      "The Remnant audited me. So I audited them. I'm still here.",
    ],
    refuse: [
      "No. The numbers don't work and I don't do sentiment.",
      "Not at that price.",
      "No. Come back with a better offer.",
    ],
    jam: [
      "Jammed. That's a repair bill.",
      "Stoppage. This is what buying cheap gets you.",
      "It's fouled. Twelve dollars of solvent, coming up.",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // COYOTE — Rosa Vidal. Roads, routes, culverts, and a receipt she has kept.
  // ═══════════════════════════════════════════════════════════════════════════════════
  coyote: {
    spawn: [
      "I've been through this sector nine times. Two of them at night.",
      "Coyote up. There's a culvert on the east side nobody uses.",
      "Give me the map and I'll give you a shortcut.",
    ],
    move: [
      "Moving. There's a track here — follow my line.",
      "Ground's soft. Step where I step.",
      "Going wide. Roads are for people who want to be seen.",
    ],
    shoot: ["Firing.", "Short burst.", "Taking the shot."],
    miss: ["Off. Truck-driver aim.", "Missed. Wind through the gap.", "Again."],
    kill: ["Down. Next.", "That's the road clear.", "Paid in full."],
    headshot: [
      "Straight through. He never saw the turn coming.",
      "Clean.",
      "That's how you close a checkpoint.",
    ],
    hurt: [
      "Hit. Keep moving, that's the rule.",
      "Nicked me. I've had worse off barbed wire.",
      "Still driving.",
    ],
    critical: [
      "Down. Damn it — I know the way out and I can't walk it.",
      "Don't leave the body for the Remnant. That's all I ask.",
      "There's a route north from here. Somebody remember that. Somebody remember it.",
    ],
    ally_down: [
      "Casualty! I know the fastest line to them — follow me!",
      "Cover the road, I'm going in!",
      "Thirty seconds, I've got the ground!",
    ],
    ally_death: [
      "One more receipt.",
      "We carry them out. I've smuggled heavier.",
      "The Basin takes everybody eventually. Doesn't mean I forgive it.",
    ],
    levelUp: [
      "Learned the terrain. Terrain's most of it.",
      "Better. Quieter, mostly.",
      "Good. New route in my head.",
    ],
    lowAmmo: [
      "Running low. There'll be a cache two sectors over.",
      "Three rounds. I know where to get more.",
      "Dry soon. Not worried.",
    ],
    reload: ["Reloading.", "New mag. Give me the corner.", "Two seconds."],
    victory: [
      "Sector's ours. I'll draw it up properly tonight.",
      "Clear. There's a fuel drum behind the barn, by the way. There always is.",
      "Done. Let's be gone before someone charges us a toll.",
    ],
    defeat: [
      "Follow me out. I know three ways and two of them work.",
      "We're leaving. Don't argue — run in my footprints.",
      "Bad ground, bad plan. My fault for not saying so louder.",
    ],
    spotZombie: [
      "Dead one, north side.",
      "Walker on the road. Quiet or loud, your call.",
      "Contact. Slow.",
    ],
    spotHorde: [
      "That's the whole highway coming at us.",
      "Too many. There's a culvert — go, now, single file.",
      "I've outrun worse. Barely. Move.",
    ],
    idle: [
      "Six years running fuel up the reservoir road. I know where every pothole is.",
      "The Remnant took my truck, my cargo, and my cousin, and gave me a receipt for it. I kept the receipt.",
      "Ask me about any sector on that map. Go on.",
    ],
    refuse: [
      "No. Not for the Remnant. Not ever, not at any number.",
      "No. That road's closed.",
      "Find someone else for that one.",
    ],
    jam: [
      "Jammed. Give me a second.",
      "Grit in the works. Story of this whole region.",
      "Stoppage — cover the lane.",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // GENERIC — anonymous humans and the dead. Deliberately faceless.
  // ═══════════════════════════════════════════════════════════════════════════════════
  enemy_human: {
    spawn: ["Contact front!", "Get to cover!", "They're on the road!"],
    move: ["Flanking!", "Moving up!", "Left side, left side!"],
    shoot: ["Firing!", "Suppress them!", "Put rounds on it!"],
    miss: ["Missed!", "Wide!", "Adjusting!"],
    kill: ["Got one!", "He's down!", "That's one of theirs!"],
    headshot: ["Dropped him!", "Straight down!", "Head shot!"],
    hurt: ["I'm hit!", "Agh! Cover me!", "Took one!"],
    critical: ["I'm down! I'm down!", "Help— somebody—", "Don't leave me here!"],
    ally_down: ["Man down!", "Get him up!", "They dropped Rey!"],
    ally_death: ["He's gone!", "They killed him! They killed him!", "That's it, that's it!"],
    levelUp: ["Still breathing.", "Learned that one the hard way.", "New scars, new tricks."],
    lowAmmo: ["Low on ammo!", "I'm nearly dry!", "Somebody throw me a mag!"],
    reload: ["Reloading!", "Changing mags, cover!", "Out — reloading!"],
    victory: ["That's the last of them!", "Strip the bodies!", "Told you they'd break."],
    defeat: ["Break contact! Run!", "It's not worth this!", "Fall back to the trucks!"],
    spotZombie: [
      "Dead ones! Behind us!",
      "The noise pulled them in!",
      "Grey ones, out of the ruins!",
    ],
    spotHorde: ["Horde! HORDE!", "That's it, we're done — run!", "Everyone out! Everyone out now!"],
    idle: ["Quiet.", "Anything?", "Keep your eyes up."],
    refuse: ["Not doing that.", "Forget it.", "You go first, then."],
    jam: ["Jammed!", "Stoppage, cover me!", "Piece of junk!"],
  },

  zombie: {
    spawn: [
      "[A dry rattle from somewhere in the ruins.]",
      "[Something upright turns toward the sound.]",
      "[A long, wet inhale.]",
    ],
    move: [
      "[Dragging steps on gravel.]",
      "[It comes on, unhurried.]",
      "[Bare feet slap the road.]",
    ],
    shoot: ["[It reaches.]", "[Broken nails on webbing.]", "[It lunges, mouth first.]"],
    miss: [
      "[It closes on empty air.]",
      "[Teeth snap shut on nothing.]",
      "[It stumbles past and turns around.]",
    ],
    kill: [
      "[It stops chewing and stands up again.]",
      "[A wet, contented sound.]",
      "[It settles over the body.]",
    ],
    headshot: ["[It bites down and does not let go.]", "[Something tears.]", "[A scream, cut short.]"],
    hurt: [
      "[It does not appear to notice.]",
      "[The round passes through and it keeps walking.]",
      "[It turns toward the impact, mildly curious.]",
    ],
    critical: [
      "[It drags itself forward on its elbows.]",
      "[Legless, and still coming.]",
      "[A ruined thing, still reaching.]",
    ],
    ally_down: [
      "[Three more turn toward the noise.]",
      "[The group shifts direction as one.]",
      "[Something in the treeline answers.]",
    ],
    ally_death: [
      "[They step over it without looking.]",
      "[No reaction at all.]",
      "[The gap closes immediately.]",
    ],
    levelUp: [
      "[It has been walking eight years. It has got better at it.]",
      "[Whatever is left of it is learning the smell of you.]",
      "[It moves faster in the warm.]",
    ],
    lowAmmo: [
      "[It has all the time in the world.]",
      "[No hurry. No hurry at all.]",
      "[It waits at the edge of the light.]",
    ],
    reload: [
      "[The rattle gets closer during the silence.]",
      "[It gains four steps.]",
      "[More come out of the dark.]",
    ],
    victory: [
      "[The chewing carries a long way in the cold.]",
      "[Nothing is standing but the dead.]",
      "[The sector goes quiet again.]",
    ],
    defeat: [
      "[They follow the sound of running.]",
      "[It loses interest and drifts toward the next noise.]",
      "[The rattle recedes.]",
    ],
    spotZombie: [
      "[It hears its own kind and ignores them.]",
      "[No recognition passes between them.]",
      "[They walk the same direction by accident.]",
    ],
    spotHorde: [
      "[The noise map lights up like a fire.]",
      "[The whole treeline moves at once.]",
      "[They arrive as a single mass.]",
    ],
    idle: [
      "[It stands in the road, swaying.]",
      "[It faces a wall and does not move.]",
      "[Somewhere, a jaw works on nothing.]",
    ],
    refuse: [
      "[It does not take orders. It never did.]",
      "[Nothing here obeys.]",
      "[It keeps walking.]",
    ],
    jam: [
      "[Nothing on this thing has ever needed maintenance.]",
      "[It has no moving parts left to fail.]",
      "[It keeps coming regardless.]",
    ],
  },
};

/**
 * Pick a line. Pure and deterministic: `roll` should come from the battle Rng so a replay
 * produces identical chatter. Returns '' when the voice or situation has nothing to say,
 * which callers treat as "stay silent" rather than as an error.
 */
export function bark(voice: string, situation: string, roll: number): string {
  const set = BARKS[voice] ?? BARKS[FALLBACK_VOICE];
  if (!set) return '';
  const lines: string[] | undefined = set[situation as BarkSituation];
  if (!lines || lines.length === 0) return '';
  const clamped = roll >= 1 ? 0.9999999 : roll < 0 ? 0 : roll;
  return lines[Math.floor(clamped * lines.length)] ?? '';
}

/** True if a voice id has a hand-written set (used to fall back to generics for enemies). */
export function hasVoice(voice: string): boolean {
  return voice in BARKS;
}
