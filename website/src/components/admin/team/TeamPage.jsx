import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, Search, Trash2, UserCog, Users, X } from "lucide-react";
import supabase from "../../helper/SupabaseClients";
import { fetchInstitutionTeamMembers, removeTeamMember, updateTeamMemberRole } from "./TeamData";
import styles from "./TeamPage.module.css";

const matchesSearch = (member, query) => {
  if (!query) return true;

  const haystack = [
    member.full_name,
    member.email,
    member.role,
    member.department
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

const ROLE_GROUPS = [
  { key: "checkit_admin", label: "System Admins" },
  { key: "checkit_field_operator", label: "System Field Operators" },
  { key: "admin", label: "Institution Admins" },
  { key: "field_operator", label: "Institution Field Operators" },
  { key: "viewer", label: "Viewers" }
];

const normalizeRole = (role) => {
  const normalized = String(role || "viewer").trim().toLowerCase();
  return normalized === "user" ? "viewer" : normalized;
};

const getRoleLabel = (role) => {
  const normalized = normalizeRole(role);
  if (normalized === "checkit_admin") return "System Admin";
  if (normalized === "checkit_field_operator") return "System Field Operator";
  if (normalized === "admin") return "Institution Admin";
  if (normalized === "field_operator") return "Institution Field Operator";
  return "Viewer";
};

const ALL_ROLE_OPTIONS = [
  { value: "checkit_admin", label: "System Admin" },
  { value: "checkit_field_operator", label: "System Field Operator" },
  { value: "admin", label: "Institution Admin" },
  { value: "field_operator", label: "Institution Field Operator" },
  { value: "viewer", label: "Viewer" }
];

const INSTITUTION_ADMIN_ROLE_OPTIONS = [
  { value: "field_operator", label: "Institution Field Operator" },
  { value: "viewer", label: "Viewer" }
];

const INSTITUTION_ADMIN_MANAGEABLE_ROLES = new Set(["field_operator", "viewer", "user"]);

const getRoleOptionsForManager = (currentUserRole) =>
  normalizeRole(currentUserRole) === "checkit_admin" ? ALL_ROLE_OPTIONS : INSTITUTION_ADMIN_ROLE_OPTIONS;

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
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedRole, setSelectedRole] = useState("viewer");
  const [confirmationName, setConfirmationName] = useState("");
  const [actionError, setActionError] = useState("");
  const [savingAction, setSavingAction] = useState("");
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

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredMembers = useMemo(
    () => sortMembersAlphabetically(members.filter((member) => matchesSearch(member, normalizedSearch))),
    [members, normalizedSearch]
  );
  const groupedMembers = useMemo(
    () => {
      const groupedRoleKeys = new Set(ROLE_GROUPS.map((group) => group.key));
      const knownGroups = ROLE_GROUPS.map((group) => ({
        ...group,
        members: filteredMembers.filter((member) => normalizeRole(member.role) === group.key)
      }));
      const otherMembers = filteredMembers.filter((member) => !groupedRoleKeys.has(normalizeRole(member.role)));
      return [
        ...knownGroups,
        { key: "other", label: "Other", members: otherMembers }
      ].filter((group) => group.members.length > 0);
    },
    [filteredMembers]
  );

  const memberCountLabel = `${filteredMembers.length} ${filteredMembers.length === 1 ? "member" : "members"}`;
  const selectedMemberName = selectedMember?.full_name || selectedMember?.email || "this member";
  const canEditSelectedMember = canManageMember(currentUserRole, currentUserId, selectedMember);
  const availableRoleOptions = getRoleOptionsForManager(currentUserRole);

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

  const openMemberActions = (member) => {
    setSelectedMember(member);
    const normalizedMemberRole = normalizeRole(member.role);
    const roleOptions = getRoleOptionsForManager(currentUserRole);
    setSelectedRole(
      roleOptions.some((option) => option.value === normalizedMemberRole)
        ? normalizedMemberRole
        : roleOptions[0].value
    );
    setConfirmationName("");
    setActionError("");
    setSavingAction("");
  };

  const closeMemberActions = () => {
    if (savingAction) return;
    setSelectedMember(null);
    setConfirmationName("");
    setActionError("");
  };

  const refreshMembers = async () => {
    const result = await fetchInstitutionTeamMembers(supabase);
    setMembers(result.members);
    setInstitutionId(result.institutionId);
    setCurrentUserId(result.currentUserId || "");
    setCurrentUserRole(result.currentUserRole || "viewer");
  };

  const saveRole = async () => {
    if (!selectedMember?.id || !canEditSelectedMember) return;
    setSavingAction("role");
    setActionError("");

    try {
      await updateTeamMemberRole(supabase, selectedMember.id, selectedRole);
      await refreshMembers();
      closeMemberActions();
    } catch (err) {
      setActionError(err.message || "Role could not be updated.");
    } finally {
      setSavingAction("");
    }
  };

  const removeMember = async () => {
    if (!selectedMember?.id || !canEditSelectedMember) return;
    if (confirmationName !== selectedMemberName) {
      setActionError("Type the member name exactly before removing them.");
      return;
    }

    setSavingAction("remove");
    setActionError("");

    try {
      await removeTeamMember(supabase, selectedMember.id);
      await refreshMembers();
      closeMemberActions();
    } catch (err) {
      setActionError(err.message || "Member could not be removed.");
    } finally {
      setSavingAction("");
    }
  };

  return (
    <main className={styles.teamShell}>
      <section className={styles.teamHeader}>
        <div>
          <h1>Team</h1>
        </div>
        <div className={styles.countPill}>
          <Users size={18} aria-hidden="true" />
          <span>{memberCountLabel}</span>
        </div>
      </section>

      <section className={styles.toolbar} aria-label="Team filters">
        <div className={styles.searchField}>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search members"
            aria-label="Search members by name, email, role, or department"
          />
        </div>
      </section>

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
        <section className={styles.roleSections} aria-label="Institution members by role">
          {groupedMembers.map((group) => (
            <div className={styles.roleSection} key={group.key}>
              <div className={styles.roleHeader}>
                <h2>{group.label}</h2>
                <span>{group.members.length}</span>
              </div>
              <div className={styles.memberGrid}>
                {group.members.map((member) => (
                  <article
                    className={`${styles.memberCard} ${canManageMember(currentUserRole, currentUserId, member) ? styles.manageableCard : ""}`}
                    key={member.id || member.email}
                    onClick={() => openMemberActions(member)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") openMemberActions(member);
                    }}
                  >
                    <div className={styles.avatar} aria-hidden="true">
                      {(member.full_name || member.email || "?").trim().charAt(0).toUpperCase()}
                    </div>
                    <div className={styles.memberText}>
                      <h3>{member.full_name || "Unnamed member"}</h3>
                      <div className={styles.emailRow}>
                        <p>{member.email || "No email available"}</p>
                        {member.email ? (
                          <button
                            aria-label={`Copy ${member.email}`}
                            className={styles.copyEmailButton}
                            onClick={(event) => {
                              event.stopPropagation();
                              copyEmail(member.email);
                            }}
                            type="button"
                          >
                            {copiedEmail === member.email ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        ) : null}
                      </div>
                      <span>{getRoleLabel(member.role)}</span>
                    </div>
                    {canManageMember(currentUserRole, currentUserId, member) ? (
                      <UserCog className={styles.manageIcon} size={18} aria-hidden="true" />
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {selectedMember ? (
        <div className={styles.modalBackdrop} onClick={closeMemberActions}>
          <section
            className={styles.memberModal}
            aria-modal="true"
            role="dialog"
            aria-labelledby="team-member-actions-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <h2 id="team-member-actions-title">{selectedMemberName}</h2>
                <p>{selectedMember.email}</p>
              </div>
              <button className={styles.iconButton} type="button" onClick={closeMemberActions} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            {!canEditSelectedMember ? (
              <div className={styles.readOnlyNotice}>
                This member cannot be managed from your account.
              </div>
            ) : (
              <>
                <label className={styles.fieldLabel} htmlFor="team-role-select">Role</label>
                <select
                  id="team-role-select"
                  className={styles.select}
                  value={selectedRole}
                  onChange={(event) => setSelectedRole(event.target.value)}
                >
                  {availableRoleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button className={styles.primaryButton} type="button" onClick={saveRole} disabled={savingAction === "role"}>
                  {savingAction === "role" ? "Saving..." : "Save role"}
                </button>

                <div className={styles.dangerZone}>
                  <div>
                    <h3>Remove from team</h3>
                    <p>Type <strong>{selectedMemberName}</strong> exactly to confirm.</p>
                  </div>
                  <input
                    className={styles.input}
                    value={confirmationName}
                    onChange={(event) => setConfirmationName(event.target.value)}
                    placeholder={selectedMemberName}
                  />
                  <button
                    className={styles.dangerButton}
                    type="button"
                    onClick={removeMember}
                    disabled={savingAction === "remove" || confirmationName !== selectedMemberName}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    {savingAction === "remove" ? "Removing..." : "Remove member"}
                  </button>
                </div>
              </>
            )}

            {actionError ? <div className={styles.actionError}>{actionError}</div> : null}
          </section>
        </div>
      ) : null}
    </main>
  );
};

export default TeamPage;
