"""Run MFA authorization checks in the isolated local checkit_mfa_test database."""
import argparse,subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host',default='/private/tmp/checkit-removal-pg-sock')
parser.add_argument('--port',default='55439')
parser.add_argument('--psql',default='/Applications/Postgres.app/Contents/Versions/latest/bin/psql')
a=parser.parse_args();tests=Path(__file__).resolve().parent
sql=(tests/'mfa.sql').read_text()
for token,name in [('migration','20261123021000_single_use_invitation_setup'),('repair','20261123030000_fix_reinvitation_signup'),('protocol','20261123040000_invitation_login_password_reset'),('provider','20261123050000_fix_provider_invite_acceptance'),('mfa','20261124010000_authenticator_mfa')]:
 text=(tests.parent/'migrations'/f'{name}.sql').read_text()
 sql=sql.replace('\\i :'+token+'_file','\n'.join(l for l in text.splitlines() if l.strip().lower() not in ['begin;','commit;']))
subprocess.run([a.psql,'-h',a.host,'-p',a.port,'-U','postgres','-d','checkit_mfa_test','-v','ON_ERROR_STOP=1'],input=sql,text=True,check=True)
