import React, { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import supabase from "../../helper/SupabaseClients";
import { fetchInstitutionTeamMembers } from "./TeamData";
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
  const [searchTerm, setSearchTerm] = useState("");
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

  const memberCountLabel = `${filteredMembers.length} ${filteredMembers.length === 1 ? "member" : "members"}`;

  return (
    <main className={styles.teamShell}>
      <section className={styles.teamHeader}>
        <div>
          <h1>Team</h1>
          <p>View the members in your institution.</p>
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
        <section className={styles.memberGrid} aria-label="Institution members">
          {filteredMembers.map((member) => (
            <article className={styles.memberCard} key={member.id || member.email}>
              <div className={styles.avatar} aria-hidden="true">
                {(member.full_name || member.email || "?").trim().charAt(0).toUpperCase()}
              </div>
              <div className={styles.memberText}>
                <h2>{member.full_name || "Unnamed member"}</h2>
                <p>{member.email || "No email available"}</p>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
};

export default TeamPage;
