/** The asymmetries this page cannot design away, stated plainly. */
export function Footnote() {
  return (
    <div className="mt-8 max-w-[750px] space-y-2 border-t border-rule pt-3 text-xs text-muted">
      <p>
        ? = unknowable, not a difference. A remote reports running/open/cold only {"—"}{" "}
        {"“"}resumable{"”"} comes from transcripts on that machine{"’"}s own disk,
        which this host cannot read. So local-resumable vs remote-cold may or may not be a real
        difference.
      </p>
      <p>
        The same gap limits {"“"}recent{"”"}: ages come from those transcripts, so a
        remote row qualifies only by being live. Work done on that machine an hour ago and then
        closed is invisible from here, and no filter can conjure it.
      </p>
    </div>
  );
}
