// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSavedSmartViews } from "./SpoolerSmartViews";

const KEY = "spooler-sidebar:smart-views:v1";
const valid = {
  id: "custom_1",
  name: "Needs me",
  query: "",
  statusFilter: "waiting",
  lifecycle: "active",
  createdAt: 1,
};

afterEach(() => localStorage.clear());

describe("loadSavedSmartViews", () => {
  it.each(["null", "{}", "42", "not json"])(
    "treats %s as no saved views",
    (raw) => {
      localStorage.setItem(KEY, raw);
      expect(loadSavedSmartViews()).toEqual([]);
    },
  );

  it("keeps well-formed views and drops malformed ones", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([valid, { ...valid, id: 7 }, { ...valid, lifecycle: "x" }, null]),
    );
    expect(loadSavedSmartViews()).toEqual([valid]);
  });
});
