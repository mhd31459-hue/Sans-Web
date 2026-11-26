import { test } from "node:test";
import assert from "node:assert/strict";
import { blasphemyHits, blasphemyForCue, profanitySegments } from "../supabase/functions/_shared/profanity.ts";

const hits = (line) => blasphemyHits(line).map(h => [line.slice(h.i, h.i + h.len).toLowerCase(), h.severity]);

test("exclamations and oaths are caught, with their strength", () => {
  assert.deepEqual(hits("Oh my God, look at this."), [["oh my god", 2]]);
  assert.deepEqual(hits("Oh my God this is amazing"), [["oh my god", 2]]);
  assert.deepEqual(hits("My God!"), [["my god", 2]]);
  assert.deepEqual(hits("God, I hate this place."), [["god", 2]]);
  assert.deepEqual(hits("- God!"), [["god", 2]]);
  assert.deepEqual(hits("Jesus, what happened here?"), [["jesus", 2]]);
  assert.deepEqual(hits("Jesus Christ!"), [["jesus christ", 2]]);
  assert.deepEqual(hits("What the... Christ."), [["christ", 2]]);
  assert.deepEqual(hits("Oh, Jesus."), [["jesus", 2]]);
  assert.deepEqual(hits("Sweet Jesus!"), [["jesus", 2]]);
  assert.deepEqual(hits("For God's sake, stop."), [["for god's sake", 2]]);
  assert.deepEqual(hits("Good God!"), [["good god", 2]]);
  assert.deepEqual(hits("OMG"), [["omg", 2]]);
  assert.deepEqual(hits("Thank God you're here."), [["thank god", 1]]);
  assert.deepEqual(hits("God knows what he did."), [["god knows", 1]]);
  assert.deepEqual(hits("I swear to God I didn't."), [["swear to god", 1]]);
  assert.deepEqual(hits("Good Lord."), [["good lord", 1]]);
  assert.deepEqual(hits("Goddamn it!"), [["goddamn", 3]]);
  assert.deepEqual(hits("God damn you."), [["god damn", 3]]);
  assert.deepEqual(hits("Jesus H. Christ."), [["jesus h. christ", 3]]);
  assert.deepEqual(hits("Jesus fucking Christ."), [["jesus fucking christ", 3]]);
});

test("reverent and ordinary uses are left alone", () => {
  for (const line of [
    "God bless you.",
    "Jesus said to them, follow me.",
    "Do you believe in God?",
    "In God we trust.",
    "My God is an awesome God.",
    "The good Lord willing, we'll make it.",
    "Yes, my lord.",
    "Jesús, ven aquí.",
    "We went to Christ Church on Sunday.",
    "It was an act of God.",
    "Godfrey and the gods of Olympus.",
  ]) assert.deepEqual(hits(line), [], line);
});

test("blasphemy becomes its own timed segments next to swear words", () => {
  const segs = profanitySegments([{ t: 100, end: 102, text: "Oh my God, that's fucking huge." }]);
  const b = segs.find(s => s.category === "blasphemy"), p = segs.find(s => s.category === "profanity");
  assert.equal(b.severity, 2); assert.equal(p.severity, 3);
  assert.ok(b.start >= 99.7 && b.end <= p.end && b.start < p.start, JSON.stringify(segs));
  assert.equal(b.source, "captions");
  assert.deepEqual(blasphemyForCue({ t: 5, end: 7, text: "[organ music] God bless." }), []);
});

test("hell: as a curse or intensifier, not the place", () => {
  assert.deepEqual(hits("What the hell is that?"), [["the hell", 1]]);
  assert.deepEqual(hits("Get the hell out of here."), [["the hell", 1]]);
  assert.deepEqual(hits("That was a hell of a game."), [["hell of a", 1]]);
  assert.deepEqual(hits("It's cold as hell."), [["as hell", 1]]);
  assert.deepEqual(hits("Hell no."), [["hell no", 1]]);
  assert.deepEqual(hits("Hell, I don't know."), [["hell", 1]]);
  assert.deepEqual(hits("Go to hell!"), [["go to hell", 2]]);
  assert.deepEqual(hits("You can rot in hell."), [["rot in hell", 2]]);
  assert.deepEqual(hits("To hell with you."), [["to hell with", 2]]);
  for (const line of ["Do you believe in hell?", "Heaven and hell.", "Dinner at Hell's Kitchen.", "Hello, shell.", "Hellboy is here."])
    assert.deepEqual(hits(line), [], line);
});
