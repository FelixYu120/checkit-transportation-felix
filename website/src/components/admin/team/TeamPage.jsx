import ProfileAvatar from "../../Header/ProfileAvatar";
import { PROFILE_UPDATED_EVENT, withProfilePhotos } from "../../Header/ProfilePhoto.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Mail, Search, Send, Trash2, UserPlus, Users, X } from "lucide-react";
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

const MEMBER_TONES = ["forest", "ocean", "indigo", "plum", "amber", "teal"];

const getMemberTone = (member) => {
  const identity = String(member.email || member.id || member.full_name || "member").trim().toLowerCase();
  const hash = Array.from(identity).reduce((value, character) => (
    (Math.imul(value, 31) + character.codePointAt(0)) >>> 0
  ), 0);
  return MEMBER_TONES[hash % MEMBER_TONES.length];
};

const normalizeRole = (role) => {
  const normalized = String(role || "viewer").trim().toLowerCase();
  return normalized === "user" ? "viewer" : normalized;
};

const MEMBER_ROLES = [
  { value: "viewer", label: "Viewer" },
  { value: "field_operator", label: "Field Operator" },
  { value: "admin", label: "Admin" },
  { value: "checkit_field_operator", label: "CheckIt Field Operator" },
  { value: "checkit_admin", label: "CheckIt Admin" },
];

const getRoleLabel = (role) =>
  MEMBER_ROLES.find((option) => option.value === normalizeRole(role))?.label || "Unknown role";

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

const isDialogBackdropEvent = (event) => {
  if (event.target !== event.currentTarget) return false;
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
  return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
};

const TeamPage = () => {
  const [members, setMembers] = useState([]);
  const [institutionId, setInstitutionId] = useState(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("viewer");
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedEmail, setCopiedEmail] = useState("");
  const [activeMember, setActiveMember] = useState(null);
  const memberDialogRef = useRef(null);
  const backdropPointerRef = useRef(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const removalDialogRef = useRef(null);
  const [confirmationName, setConfirmationName] = useState("");
  const [actionError, setActionError] = useState("");
  const [removalMessage, setRemovalMessage] = useState("");
  const [savingAction, setSavingAction] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteDialogRef = useRef(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
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
    if (!removalMessage) return undefined;
    const timer = window.setTimeout(() => setRemovalMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [removalMessage]);

  useEffect(() => {
    const updated = ({ detail }) => {
      if (!detail?.id) return;
      const photo = { avatar_path: detail.avatar_path, avatar_url: detail.avatar_url || '' };
      setMembers(current => current.map(member => member.id === detail.id ? { ...member, ...photo } : member));
      setActiveMember(current => current?.id === detail.id ? { ...current, ...photo } : current);
    };
    window.addEventListener(PROFILE_UPDATED_EVENT, updated);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, updated);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setInterval(async () => {
      const refreshed = await withProfilePhotos(supabase, members);
      if (!active) return;
      setMembers(refreshed);
      setActiveMember(current => current ? refreshed.find(member => member.id === current.id) || current : null);
    }, 45 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [members]);

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

  useEffect(() => {
    const dialog = inviteDialogRef.current;
    if (inviteOpen && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector('input[type="email"]')?.focus();
    }
  }, [inviteOpen]);

  const getDialogBackdropProps = (closeDialog) => ({
    onPointerDown: (event) => {
      backdropPointerRef.current = isDialogBackdropEvent(event) ? event.currentTarget : null;
    },
    onClick: (event) => {
      const startedOutside = backdropPointerRef.current === event.currentTarget;
      backdropPointerRef.current = null;
      if (startedOutside && isDialogBackdropEvent(event)) closeDialog();
    },
  });

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
  const inviteRoles = MEMBER_ROLES.filter((option) => (
    normalizeRole(currentUserRole) === "checkit_admin" ||
    (normalizeRole(currentUserRole) === "admin" && ["viewer", "field_operator"].includes(option.value))
  ));

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
    setInviteRole("viewer");
  };

  const closeInviteModal = () => {
    if (inviteLoading) return;
    inviteDialogRef.current?.close();
    setInviteOpen(false);
    setInviteEmail("");
    setInviteError("");
    setInviteMessage("");
    setInviteRole("viewer");
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
      setRemovalMessage(`${selectedMemberName} was removed.`);
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
    if (!inviteRoles.some((option) => option.value === inviteRole)) {
      setInviteError("Choose a role you can assign.");
      return;
    }

    setInviteLoading(true);
    setInviteError("");
    setInviteMessage("");

    try {
      await inviteTeamMember(supabase, { email, role: inviteRole });
      setInviteMessage("Invited");
      setInviteEmail("");
      setInviteRole("viewer");
      try {
        await refreshMembers();
      } catch (refreshError) {
        console.warn("Team list refresh failed after invitation:", refreshError);
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
              <UserPlus size={16} aria-hidden="true" />
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

      {removalMessage ? (
        <div className={styles.removalSuccess}>
          <p role="status">{removalMessage}</p>
          <button type="button" className={styles.dismissMessageButton} aria-label="Dismiss removal message" onClick={() => setRemovalMessage("")}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

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
            <article className={styles.memberCard} key={member.id || member.email} data-member-tone={getMemberTone(member)}>
              <button
                className={styles.memberDetailsButton}
                type="button"
                onClick={() => setActiveMember(member)}
                aria-label={`View details for ${member.full_name || member.email || "member"}`}
                aria-haspopup="dialog"
              >
                <ProfileAvatar className={styles.avatar} tone={getMemberTone(member)} profile={member} />
                <span className={styles.memberText}>
                  <span className={styles.memberNameRow}>
                    <span className={styles.memberName} title={member.full_name || "Unnamed member"}>{member.full_name || "Unnamed member"}</span>
                    {member.id === currentUserId ? <span className={styles.youBadge}>You</span> : null}
                  </span>
                  <span className={styles.roleBadge} data-role={normalizeRole(member.role)} title={member.removal_pending ? "Removal pending" : getRoleLabel(member.role)}>{member.removal_pending ? "Removal pending" : getRoleLabel(member.role)}</span>
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
          {...getDialogBackdropProps(closeMemberDetails)}
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
            <ProfileAvatar className={styles.avatar} tone={getMemberTone(activeMember)} profile={activeMember} />
            <div>
              <p className={styles.memberDetailsEyebrow}>Team member</p>
              <h3>{activeMember.full_name || "Unnamed member"}</h3>
            </div>
          </div>
          <dl className={styles.memberDetailsFields}>
            <div>
              <dt>Role</dt>
              <dd><span className={styles.roleBadge} data-role={normalizeRole(activeMember.role)}>{getRoleLabel(activeMember.role)}</span></dd>
            </div>
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
          {...getDialogBackdropProps(closeRemoveConfirmation)}
          aria-describedby="team-remove-description"
          onCancel={(event) => {
            event.preventDefault();
            closeRemoveConfirmation();
          }}
        >
          <form onSubmit={removeMember}>
            <div className={styles.modalHeader}>
              <h2 id="team-remove-title">Permanently remove account?</h2>
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
              <ProfileAvatar className={styles.avatar} tone={getMemberTone(selectedMember)} profile={selectedMember} />
              <div>
                <h3>{selectedMemberName}</h3>
                {selectedMember.email ? <p>{selectedMember.email}</p> : null}
              </div>
            </div>

            <p id="team-remove-description" className={styles.removalDescription}>
              Type <strong>{selectedMemberName}</strong> to confirm.
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
                {savingAction === "remove" ? "Removing..." : "Permanently remove"}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}

      {inviteOpen ? (
        <dialog
          ref={inviteDialogRef}
          className={`${styles.memberModal} ${styles.inviteModal}`}
          aria-modal="true"
          aria-labelledby="team-invite-title"
          {...getDialogBackdropProps(closeInviteModal)}
          onCancel={(event) => {
            event.preventDefault();
            closeInviteModal();
          }}
        >
          <form className={styles.inviteForm} onSubmit={sendInvite} aria-busy={inviteLoading}>
            <div className={styles.inviteModalHeader}>
              <div className={styles.inviteModalTitle}>
                <div className={styles.inviteIcon}>
                  <UserPlus size={17} aria-hidden="true" />
                </div>
                <h2 id="team-invite-title">Invite member</h2>
              </div>
              <button className={styles.iconButton} type="button" onClick={closeInviteModal} aria-label="Close" disabled={inviteLoading}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.inviteModalBody}>
              <div className={styles.inviteModalFields}>
                <label className={styles.inviteModalField}>
                  <span>Email</span>
                  <input
                    className={styles.input}
                    type="email"
                    value={inviteEmail}
                    disabled={inviteLoading}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="name@organization.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <label className={styles.inviteModalField}>
                  <span>Role</span>
                  <span className={styles.inviteRoleSelect}>
                    <select
                      id="team-invite-role"
                      name="role"
                      className={styles.input}
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value)}
                      disabled={inviteLoading}
                      required
                    >
                      {inviteRoles.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} aria-hidden="true" />
                  </span>
                </label>
              </div>
              {inviteMessage ? <div className={styles.inviteSuccess} role="status">{inviteMessage}</div> : null}
              {inviteError ? <div className={styles.inviteError} role="alert">{inviteError}</div> : null}
            </div>

            <div className={styles.inviteModalFooter}>
              <button className={styles.cancelButton} type="button" onClick={closeInviteModal} disabled={inviteLoading}>
                Cancel
              </button>
              <button className={styles.primaryButton} type="submit" disabled={inviteLoading || !inviteEmail.trim()}>
                <Send size={15} aria-hidden="true" />
                {inviteLoading ? "Sending..." : "Send invite"}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </main>
  );
};

export default TeamPage;
