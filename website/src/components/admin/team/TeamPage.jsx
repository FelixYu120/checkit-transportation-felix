import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Mail, Plus, Search, Send, Trash2, UserPlus, Users, X } from "lucide-react";
import supabase from "../../helper/SupabaseClients";
import { fetchInstitutionTeamMembers, inviteTeamMember, removeTeamMember } from "./TeamData";
import styles from "./TeamPage.module.css";

const matchesSearch = (member, query) => {
  if (!query) return true;

  const haystack = [
    member.full_name,
    member.email
  ].filter(Boolean).join(" ").toLowerCase();

  return haystack.includes(query);
};

const getMemberSortLabel = (member) =>
  String(member.full_name || member.email || "").trim().toLowerCase();

const sortMembersAlphabetically = (members) =>
  [...members].sort((firstMember, secondMember) =>
    getMemberSortLabel(firstMember).localeCompare(getMemberSortLabel(secondMember), undefined, {
      sensitivity: "base"
    })
  );

const getMemberInitials = (member) => {
  const words = String(member.full_name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return String(member.email || "?").slice(0, 2).toUpperCase();
  return [words[0], ...(words.length > 1 ? [words[words.length - 1]] : [])]
    .map((word) => Array.from(word)[0]).join("").toUpperCase();
};

const normalizeRole = (role) => {
  const normalized = String(role || "viewer").trim().toLowerCase();
  return normalized === "user" ? "viewer" : normalized;
};

const INSTITUTION_ADMIN_MANAGEABLE_ROLES = new Set(["field_operator", "viewer", "user"]);

const canManageMember = (currentUserRole, currentUserId, member) => {
  const normalizedCurrentRole = normalizeRole(currentUserRole);
  const normalizedMemberRole = normalizeRole(member?.role);
  if (normalizedCurrentRole === "checkit_admin") {
    return Boolean(member?.id && member.id !== currentUserId);
  }

  return Boolean(
    normalizedCurrentRole === "admin" &&
    member?.id &&
    member.id !== currentUserId &&
    INSTITUTION_ADMIN_MANAGEABLE_ROLES.has(normalizedMemberRole)
  );
};

const TeamSkeleton = () => (
  <div className={styles.memberGrid} aria-label="Loading team members">
    {Array.from({ length: 6 }).map((_, index) => (
      <div className={styles.skeletonCard} key={index}>
        <div className={styles.skeletonAvatar} />
        <div className={styles.skeletonLineLarge} />
        <div className={styles.skeletonLineSmall} />
      </div>
    ))}
  </div>
);

const TeamPage = () => {
  const [members, setMembers] = useState([]);
  const [institutionId, setInstitutionId] = useState(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("viewer");
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedEmail, setCopiedEmail] = useState("");
  const [activeMember, setActiveMember] = useState(null);
  const memberDialogRef = useRef(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const removalDialogRef = useRef(null);
  const [confirmationName, setConfirmationName] = useState("");
  const [actionError, setActionError] = useState("");
  const [removalMessage, setRemovalMessage] = useState("");
  const [savingAction, setSavingAction] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadTeam = async () => {
      setLoading(true);
      setError("");

      try {
        const result = await fetchInstitutionTeamMembers(supabase);
        if (!isMounted) return;
        setMembers(result.members);
        setInstitutionId(result.institutionId);
        setCurrentUserId(result.currentUserId || "");
        setCurrentUserRole(result.currentUserRole || "viewer");
      } catch (err) {
        if (!isMounted) return;
        setError(err.message || "Team members could not be loaded.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadTeam();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const dialog = removalDialogRef.current;
    if (selectedMember && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector("input")?.focus();
    }
  }, [selectedMember]);

  useEffect(() => {
    const dialog = memberDialogRef.current;
    if (activeMember && dialog && !dialog.open) dialog.showModal();
  }, [activeMember]);

  const closeMemberDetails = () => {
    memberDialogRef.current?.close();
    setActiveMember(null);
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredMembers = useMemo(
    () => sortMembersAlphabetically(members.filter((member) => matchesSearch(member, normalizedSearch))),
    [members, normalizedSearch]
  );

  const memberCountLabel = `${filteredMembers.length} ${filteredMembers.length === 1 ? "member" : "members"}`;
  const selectedMemberName = String(selectedMember?.full_name || selectedMember?.email || "this member").trim();
  const canEditSelectedMember = canManageMember(currentUserRole, currentUserId, selectedMember);
  const removalNameMatches = confirmationName.trim() === selectedMemberName;
  const canInviteMembers = ["checkit_admin", "admin"].includes(normalizeRole(currentUserRole));

  const copyEmail = async (email) => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      window.setTimeout(() => setCopiedEmail((current) => (current === email ? "" : current)), 1400);
    } catch {
      setCopiedEmail("");
    }
  };

  const openRemoveConfirmation = (member) => {
    if (!canManageMember(currentUserRole, currentUserId, member)) return;
    closeMemberDetails();
    setRemovalMessage("");
    setSelectedMember(member);
    setConfirmationName("");
    setActionError("");
    setSavingAction("");
  };

  const closeRemoveConfirmation = () => {
    if (savingAction) return;
    removalDialogRef.current?.close();
    setSelectedMember(null);
    setConfirmationName("");
    setActionError("");
  };

  const openInviteModal = () => {
    setInviteEmail("");
    setInviteError("");
    setInviteOpen(true);
    setInviteMessage("");
  };

  const closeInviteModal = () => {
    if (inviteLoading) return;
    setInviteOpen(false);
    setInviteEmail("");
    setInviteError("");
    setInviteMessage("");
  };

  const refreshMembers = async () => {
    const result = await fetchInstitutionTeamMembers(supabase);
    setMembers(result.members);
    setInstitutionId(result.institutionId);
    setCurrentUserId(result.currentUserId || "");
    setCurrentUserRole(result.currentUserRole || "viewer");
  };

  const removeMember = async (event) => {
    event.preventDefault();
    if (savingAction || !selectedMember?.id || !canEditSelectedMember) return;
    if (!removalNameMatches) {
      setActionError("Type the member name exactly before removing them.");
      return;
    }

    setSavingAction("remove");
    setActionError("");

    try {
      await removeTeamMember(supabase, selectedMember.id);
      setMembers((current) => current.filter((member) => member.id !== selectedMember.id));
      setRemovalMessage(`${selectedMemberName} was removed from the team.`);
      removalDialogRef.current?.close();
      setSelectedMember(null);
      setConfirmationName("");
    } catch (err) {
      setActionError(err.message || "Member could not be removed.");
    } finally {
      setSavingAction("");
    }
  };

  const sendInvite = async (event) => {
    event.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!canInviteMembers || inviteLoading || !email) return;

    setInviteLoading(true);
    setInviteError("");
    setInviteMessage("");

    try {
      const result = await inviteTeamMember(supabase, { email, role: "viewer" });
      setInviteMessage(
        result?.reactivated || result?.restored
          ? `Team access restored for ${email}. They can sign in with their existing account; no new invitation email was sent.`
          : `Invite sent to ${email}.`
      );
      setInviteEmail("");
      try {
        await refreshMembers();
      } catch {
        setInviteError("The invitation was successful, but the team list could not be refreshed. Reload this page to see the latest members.");
      }
    } catch (err) {
      setInviteError(err.message || "Invite could not be sent.");
    } finally {
      setInviteLoading(false);
    }
  };

  return (
    <main className={styles.teamShell}>
      <section className={styles.teamHeader}>
        <div>
          <h1>Teams</h1>
          <p>Manage your organization’s members.</p>
        </div>
        <div className={styles.headerActions}>
          {canInviteMembers ? (
            <button className={styles.inviteTrigger} type="button" onClick={openInviteModal} aria-label="Invite member">
              <Plus size={18} aria-hidden="true" />
              <span>Invite member</span>
            </button>
          ) : null}
        </div>
      </section>

      <section className={styles.toolbar} aria-label="Team filters">
        <div className={styles.directoryHeading}>
          <Users size={18} aria-hidden="true" />
          <h2>{normalizedSearch ? "Search results" : "All members"}</h2>
          <span className={styles.countPill} aria-live="polite">{memberCountLabel}</span>
        </div>
        <div className={styles.searchField}>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by name or email"
            aria-label="Search members by name or email"
          />
        </div>
      </section>

      {removalMessage ? <p className={styles.removalSuccess} role="status">{removalMessage}</p> : null}

      {loading && <TeamSkeleton />}

      {!loading && error && (
        <section className={styles.stateBox} role="alert">
          <h2>Team could not be loaded</h2>
          <p>{error}</p>
        </section>
      )}

      {!loading && !error && !institutionId && (
        <section className={styles.stateBox}>
          <h2>No institution assigned</h2>
          <p>Your profile is not connected to an institution yet.</p>
        </section>
      )}

      {!loading && !error && institutionId && filteredMembers.length === 0 && (
        <section className={styles.stateBox}>
          <h2>No members found</h2>
          <p>Try a different search or check that profiles are assigned to your institution.</p>
        </section>
      )}

      {!loading && !error && filteredMembers.length > 0 && (
        <section className={styles.memberGrid} aria-label="Team members">
          {filteredMembers.map((member) => (
            <article className={styles.memberCard} key={member.id || member.email}>
              <button
                className={styles.memberDetailsButton}
                type="button"
                onClick={() => setActiveMember(member)}
                aria-label={`View details for ${member.full_name || member.email || "member"}`}
                aria-haspopup="dialog"
              >
                <span className={styles.avatar} aria-hidden="true">
                  {getMemberInitials(member)}
                </span>
                <span className={styles.memberText}>
                  <span className={styles.memberNameRow}>
                    <span className={styles.memberName}>{member.full_name || "Unnamed member"}</span>
                    {member.id === currentUserId ? <span className={styles.youBadge}>You</span> : null}
                  </span>
                  <span className={styles.memberEmail}>{member.email || "No email available"}</span>
                </span>
                <ChevronRight className={styles.memberDetailsArrow} size={16} aria-hidden="true" />
              </button>
              {canManageMember(currentUserRole, currentUserId, member) ? (
                <button
                  className={styles.removeMemberButton}
                  type="button"
                  onClick={() => openRemoveConfirmation(member)}
                  aria-label={`Remove ${member.full_name || member.email || "member"} from team`}
                  title="Remove from team"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              ) : null}
            </article>
          ))}
        </section>
      )}

      {activeMember ? (
        <dialog
          ref={memberDialogRef}
          className={`${styles.memberModal} ${styles.memberDetailsDialog}`}
          aria-labelledby="team-member-details-title"
          onCancel={(event) => {
            event.preventDefault();
            closeMemberDetails();
          }}
        >
          <div className={styles.memberDetailsHeader}>
            <h2 id="team-member-details-title">Member details</h2>
            <button className={styles.iconButton} type="button" onClick={closeMemberDetails} aria-label="Close member details">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.memberDetailsProfile}>
            <div className={styles.avatar} aria-hidden="true">
              {getMemberInitials(activeMember)}
            </div>
            <div>
              <p className={styles.memberDetailsEyebrow}>Team member</p>
              <h3>{activeMember.full_name || "Unnamed member"}</h3>
            </div>
          </div>
          <dl className={styles.memberDetailsFields}>
            <div>
              <dt>Email</dt>
              <dd>
                {activeMember.email ? (
                  <button
                    className={styles.emailButton}
                    type="button"
                    onClick={() => copyEmail(activeMember.email)}
                    aria-label={copiedEmail === activeMember.email ? `Copied ${activeMember.email}` : `Copy ${activeMember.email}`}
                    data-copied={copiedEmail === activeMember.email}
                  >
                    <Mail size={18} aria-hidden="true" />
                    <span>{activeMember.email}</span>
                    {copiedEmail === activeMember.email ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
                  </button>
                ) : "No email available"}
              </dd>
            </div>
          </dl>
          {canManageMember(currentUserRole, currentUserId, activeMember) ? (
            <div className={styles.memberDetailsFooter}>
              <button className={styles.removeFromProfileButton} type="button" onClick={() => openRemoveConfirmation(activeMember)}>
                <X size={16} aria-hidden="true" />
                Remove from team
              </button>
            </div>
          ) : null}
        </dialog>
      ) : null}

      {selectedMember ? (
        <dialog
          ref={removalDialogRef}
          className={`${styles.memberModal} ${styles.removalDialog}`}
          aria-labelledby="team-remove-title"
          aria-describedby="team-remove-description"
          onCancel={(event) => {
            event.preventDefault();
            closeRemoveConfirmation();
          }}
        >
          <form onSubmit={removeMember}>
            <div className={styles.modalHeader}>
              <h2 id="team-remove-title">Remove team member?</h2>
              <button
                className={styles.iconButton}
                type="button"
                onClick={closeRemoveConfirmation}
                aria-label="Close removal confirmation"
                disabled={Boolean(savingAction)}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.removalProfile}>
              <div className={styles.avatar} aria-hidden="true">
                {getMemberInitials(selectedMember)}
              </div>
              <div>
                <h3>{selectedMemberName}</h3>
                {selectedMember.email ? <p>{selectedMember.email}</p> : null}
              </div>
            </div>

            <p id="team-remove-description" className={styles.removalDescription}>
              To remove this person from the team, type <strong>{selectedMemberName}</strong> exactly as shown.
            </p>
            <label className={styles.confirmationLabel} htmlFor="team-remove-name">
              {selectedMember.full_name ? "Full name" : "Email address"}
            </label>
            <input
              id="team-remove-name"
              className={styles.input}
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              placeholder={selectedMemberName}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={Boolean(savingAction)}
            />

            {actionError ? <div className={styles.actionError} role="alert">{actionError}</div> : null}

            <div className={styles.confirmationActions}>
              <button
                className={styles.cancelButton}
                type="button"
                onClick={closeRemoveConfirmation}
                disabled={Boolean(savingAction)}
              >
                Cancel
              </button>
              <button
                className={styles.dangerButton}
                type="submit"
                disabled={Boolean(savingAction) || !canEditSelectedMember || !removalNameMatches}
              >
                <Trash2 size={16} aria-hidden="true" />
                {savingAction === "remove" ? "Removing..." : "Remove member"}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}

      {inviteOpen ? (
        <div className={styles.modalBackdrop} onClick={closeInviteModal}>
          <form
            className={`${styles.memberModal} ${styles.inviteModal}`}
            aria-modal="true"
            role="dialog"
            aria-labelledby="team-invite-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={sendInvite}
          >
            <div className={styles.modalHeader}>
              <div className={styles.inviteModalTitle}>
                <div className={styles.inviteIcon}>
                  <UserPlus size={18} aria-hidden="true" />
                </div>
                <h2 id="team-invite-title">Invite member</h2>
              </div>
              <button className={styles.iconButton} type="button" onClick={closeInviteModal} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className={styles.inviteModalFields}>
              <label className={styles.inviteModalField}>
                <span>Email</span>
                <input
                  className={styles.input}
                  type="email"
                  value={inviteEmail}
                  disabled={inviteLoading}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </label>
            </div>

            <button className={styles.primaryButton} type="submit" disabled={inviteLoading || !inviteEmail.trim()}>
              <Send size={16} aria-hidden="true" />
              {inviteLoading ? "Sending..." : "Send invite"}
            </button>

            {inviteMessage ? <div className={styles.inviteSuccess} role="status">{inviteMessage}</div> : null}
            {inviteError ? <div className={styles.inviteError} role="alert">{inviteError}</div> : null}
          </form>
        </div>
      ) : null}
    </main>
  );
};

export default TeamPage;
