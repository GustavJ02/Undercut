import { CONTACT_EMAIL, DISCLAIMER, REPO_URL } from "../legal";

/** The disclaimer and the address for rights holders: the footer of the landing page, and the foot of the setup screens. */
export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`legal ${className}`}>
      <p>{DISCLAIMER}</p>
      <p>
        Rights holders: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> · <a href="/THIRD_PARTY_NOTICES.txt">Third-party notices</a> · <a href={REPO_URL} target="_blank" rel="noreferrer">Source</a>
      </p>
    </footer>
  );
}
