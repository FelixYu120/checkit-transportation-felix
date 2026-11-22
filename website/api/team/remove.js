import { callSupabase } from './invite.js';
import { createTeamRemovalHandler } from '../../server/team-removal.js';

export default createTeamRemovalHandler(callSupabase);
