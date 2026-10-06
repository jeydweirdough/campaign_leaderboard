import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDoctors, doctorNameKey, parseDoctorName } from "./doctor-match";

// Real spellings seen in GetMEDS Zoho invoices.
const level = (a: string, b: string) => compareDoctors(a, b)?.level ?? null;

test("titles, credentials, punctuation and case don't matter", () => {
  assert.equal(doctorNameKey("Roxan A. Perez, M.D."), doctorNameKey("roxan a perez"));
  assert.equal(doctorNameKey("Dra. EDESSA REYES CASALLA"), "edessa reyes casalla");
  assert.equal(doctorNameKey("Dr.  Tee"), "tee");
  assert.equal(level("Dr. Roxan A. Perez", "Roxan A. Perez, M.D."), "same");
});

test("'Last, First' order", () => {
  assert.deepEqual(parseDoctorName("Perez, Roxan A.").last, "perez");
  assert.equal(level("Perez, Roxan", "Roxan Perez"), "same");
});

test("shortened or longer names are the same doctor", () => {
  assert.equal(level("Doc Matt Yap", "Matthew G. Yap"), "same");
  assert.equal(level("Dr Lynn Bonifacio", "Lyn Bonifacio"), "same");
  assert.equal(level("Dr. Audie V. Cuntapay", "Audie Cuntapay"), "same");
  assert.equal(level("Dra. EDESSA REYES CASALLA", "Edessa Casalla"), "same");
  assert.equal(level("FRANCIEN BONIFACIA LUMAUAG", "Francien Lumauag"), "same");
});

test("ambiguous cases need a human", () => {
  assert.equal(level("Dr. Osias", "Dr. Lucille Osias"), "possible");
  assert.equal(level("Eric Royd Talavera", "Eric Joseph Talavera"), "possible");
  assert.equal(level("J. Retiro", "Jane Frances Retiro"), "possible");
  assert.equal(level("Dr. Irene Castillio", "Irene Castillo"), "possible");
});

test("different doctors", () => {
  assert.equal(level("Rowel David Yap", "Matthew Yap"), null);
  assert.equal(level("Bernadette Yap-Abella", "Matthew Yap"), null);
  assert.equal(level("Ana Teresa Hernandez", "Katherine V. Hernandez"), null);
  assert.equal(level("Regina Perez", "Roxan Perez"), null);
});

test("'Ma.' (Maria) prefix and small typos", () => {
  assert.equal(compareDoctors("Ma. Theira  Dumalaon", "Ma. Thierra Dumalaon")?.reason, "First name spelled differently (theira / thierra)");
  assert.equal(level("Ma. Thierra Dumalaon", "Thierra Dumalaon"), "same");
  assert.match(compareDoctors("Amelie Crislyd Avenido", "Amelie Cryslid Avenido")?.reason ?? "", /Middle name spelled differently/);
  assert.equal(level("Dr. Arianna Dominique Recio", "ARIANNE DOMINIQUE RECIO"), "possible");
});
