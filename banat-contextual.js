"use strict";

/**
 * Contextual Banat replies.
 *
 * Looks at what the other person just said and answers it directly:
 * "hi" -> "hello", "talo ka" -> a comeback about the scoreboard, a question
 * -> a rival-style answer, and so on. Returns null when nothing matches so
 * triggers.js can fall back to the normal random pools.
 *
 * Rules are checked in order (specific accusations first, greetings after).
 * Replies are light banter only: no threats, slurs, or personal insults.
 */

const { pickFromBag } = require("./banat-randomizer");
const { rememberBanatReply } = require("./banat-memory");

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[“”‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text) {
  return text.split(" ").filter(Boolean).length;
}

const RULES = [
  {
    name: "you-lose",
    test: /\b(?:talo ka|natalo ka|ikaw (?:ang )?talo|loser ka|lose ka)\b/,
    replies: [
      "ako pa talaga ang talo? tingnan mo muna scoreboard",
      "talo? sino sa'tin ang nauubusan ng sagot",
      "ako ang talo? sige, ulitin mo nga para marinig ng lahat",
      "kung ako ang talo, bakit ikaw ang kumakapit pa rin",
      "ang lakas mong magsabi ng talo, ikaw nga ang nahihirapan",
      "baligtad ata ang nakikita mo, ayusin mo salamin mo",
    ],
  },
  {
    name: "i-win",
    test: /\b(?:panalo ako|nanalo ako|ako (?:ang )?(?:panalo|nanalo)|i win|ez lang|ez na)\b/,
    replies: [
      "panalo ka? saan, sa imagination mo",
      "nanalo ka na pala, bakit hindi ko alam",
      "sige, ikaw na panalo, hanggang sa susunod na round",
      "panalo ka lang kasi wala pa ako sa tamang mood",
      "ayan ka na naman, nagdiriwang bago pa matapos ang laban",
      "kung panalo ka, bakit ang ingay mo pa rin",
    ],
  },
  {
    name: "you-weak",
    test: /\b(?:mahina ka|ang hina mo|hina mo|weak ka|ang weak mo)\b/,
    replies: [
      "mahina? sinubukan mo na ba akong tapatan",
      "mahina raw, eh ikaw ang nauuna lagi sa pagod",
      "ang hina ko pala, bakit ikaw ang pikon",
      "sabihin mo yan kapag nakaabot ka na sa level ko",
      "mahina ako sa paningin mo, kasi malabo mata mo",
      "ayan, ginagaya mo na ang sinasabi sa'yo, wala ka na bang sariling banat",
    ],
  },
  {
    name: "i-strong",
    test: /\b(?:malakas ako|magaling ako|ako (?:ang )?(?:pinaka|best|boss|bida|pinakamalakas|pinakamagaling)|ako na|ako lang|i'm the best|im the best)\b/,
    replies: [
      "ang yabang, saan galing yan, wala ka pa ngang napapatunayan",
      "malakas ka? ipakita mo, hindi yung puro salita",
      "ikaw na ba talaga yan, o pinag-aralan mo lang sabihin",
      "bida ka raw, eh extra pa lang ang role mo",
      "sige, ikaw na, hanggang diyan lang yan",
      "kung magaling ka, bakit kailangan mo pang ipaalam",
    ],
  },
  {
    name: "challenge",
    test: /\b(?:tara(?:\s+na)?|laban|labanan|game ka|g ka|subukan mo|lapit ka|harapin mo|sige nga|away tayo|tapatan mo)\b/,
    replies: [
      "game ako, ikaw ba, o puro hamon lang",
      "tara, pero huwag kang aatras mamaya",
      "sige, lapit ka, hindi kita uurungan",
      "hinamon mo ako, panindigan mo",
      "laban? sige, ikaw ang mauuna para makita natin",
      "handa ako anytime, ikaw ba",
    ],
  },
  {
    name: "greeting",
    test: /^(?:hi+|hello+|helo+|hey+|hai+|yo+|oi+|uy+|kumusta|kamusta|musta|good\s*(?:morning|evening|afternoon|day)|gm|ge+|hoy+|psst+)\b/,
    maxWords: 6,
    replies: [
      "hello",
      "helo",
      "hi din",
      "hello din",
      "oh, hello, nandito ka na pala",
      "hi? akala ko hahamon mo na ako",
      "hello, kanina pa kita hinihintay, talo ka na",
      "uy, hello, handa ka na bang matalo",
      "hello, ano na naman ang kailangan mo",
      "ayos lang ako, panalo eh, ikaw",
      "musta ka na, mukhang ikaw ang talo kanina",
    ],
  },
  {
    name: "bye",
    test: /\b(?:bye+|babay|alis na|una na ako|tulog na|good\s*night|goodnight|gn|paalam|logout|log out)\b/,
    maxWords: 8,
    replies: [
      "sige, umalis ka na bago ka pa mapahiya",
      "bye, balik ka kapag handa ka na",
      "ayan, tumakbo na naman",
      "goodnight, bukas ulit, ako pa rin panalo",
      "alis ka na? hindi pa tayo tapos",
      "sige, ingat, huwag mong kalimutan ang pagkatalo mo",
    ],
  },
  {
    name: "thanks",
    test: /\b(?:salamat|thanks|thank you|thankyou|tnx|ty)\b/,
    maxWords: 8,
    replies: [
      "walang anuman, libre lang ang pagkatalo mo",
      "wag kang magpasalamat, ituloy mo lang ang laban",
      "oo na, welcome, ngayon bumalik ka na sa pagiging kalaban",
      "salamat? ngayon ka pa naging mabait",
      "sige, pagbibigyan kita, huwag ka lang magbabago ng isip",
    ],
  },
  {
    name: "sorry",
    test: /\b(?:sorry|sori|pasensya|patawad|my bad|pasensiya)\b/,
    maxWords: 10,
    replies: [
      "sorry? ngayon ka pa humingi ng tawad",
      "tinatanggap ko, pero hindi pa rin kita palalampasin",
      "sorry ka na pala, ang bilis mong sumuko",
      "sige na, pinapatawad na kita, para matahimik na tayo",
      "huli na ang sorry mo, tapos na ang laban",
    ],
  },
  {
    name: "laugh",
    test: /^(?:(?:ha){2,}|(?:he){2,}|(?:hi){3,}|(?:ah){2,}|lol|lmao|lmfao|xd|rofl|\u{1F602}|\u{1F923})/u,
    maxWords: 6,
    replies: [
      "tumatawa ka pa, kanina ka pa talo",
      "anong nakakatawa, ikaw ba yan",
      "tawa ka ng tawa, hindi mo pa rin ako natatalo",
      "natutuwa ka? sandali lang yan",
      "hahaha, ang cute mo kapag kinakabahan",
      "tawa pa, mamaya iyak naman",
    ],
  },
  {
    name: "agree",
    test: /^(?:oo+|yes|yep|yup|oo nga|tama|sige|ok+|okay|ge|g|sige na)\s*[!.]*$/,
    replies: [
      "buti naman at umamin ka",
      "ayan, sumasang-ayon ka rin pala",
      "tama ka riyan, ngayon lang yan",
      "oo, tama ka, sana laging ganyan",
      "okay, sige, ngayon alam mo na",
    ],
  },
  {
    name: "deny",
    test: /^(?:hindi|di|ayoko|ayaw|no+|nope|hindi ah|di ah|hindi po)\b/,
    maxWords: 6,
    replies: [
      "hindi? tanggihan mo man, ako pa rin ang tama",
      "tanggi ka pa, halata namang tinamaan ka",
      "ayaw mo pala, eh bakit ka nandito",
      "hindi ba, ayaw mo lang aminin",
      "hindi raw, eh ang bilis mong sumagot",
    ],
  },
  {
    name: "whatever",
    test: /\b(?:ewan|bahala ka|wala akong pake|di ko pake|so what|edi wow|ano ngayon|tapos\s*na)\b/,
    maxWords: 10,
    replies: [
      "wala kang pake pero sumagot ka, ang galing",
      "edi wow, ikaw ang sumagot pa rin",
      "ano ngayon? eh ikaw ang naunang nag-ingay",
      "bahala ako, kasi ako ang panalo",
      "ewan mo, pero bumalik ka pa rin",
    ],
  },
  {
    name: "question",
    test: /(?:\?\s*$)|^(?:bakit|bat|bkt|ano|sino|saan|paano|pano|kailan|ilan|alin|ba't)\b/,
    maxWords: 14,
    replies: [
      "tanong ka ng tanong, hindi mo pa rin alam ang sagot",
      "bakit? kasi ako ang panalo, simple lang",
      "ikaw na lang ang sumagot, mukhang alam mo naman",
      "tanong mo sa sarili mo, baka may sagot na dyan",
      "ang dami mong tanong, wala namang dalang sagot",
      "ano sa tingin mo, ikaw ang magsabi",
      "sagutin ko yan kapag nanalo ka na",
      "mukhang naliligaw ka na, ako ang itanong mo ng direksyon",
    ],
  },
];

/**
 * @param {string} body    what the other person just wrote
 * @param {string} threadID thread used for no-repeat rotation
 * @returns {string|null}
 */
function getContextualReply(body, threadID = "") {
  const text = norm(body);
  if (!text || text.length > 200) return null;
  const words = wordCount(text);

  for (const rule of RULES) {
    if (rule.maxWords && words > rule.maxWords) continue;
    if (!rule.test.test(text)) continue;

    const reply = pickFromBag(String(threadID || "unknown"), `ctx-${rule.name}`, rule.replies);
    if (reply) rememberBanatReply(threadID, reply);
    return reply || null;
  }
  return null;
}

module.exports = { getContextualReply, RULES };
