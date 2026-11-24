"""Run one-use invitation tests in an isolated local database; fixtures roll back."""
import argparse
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', default='/tmp')
parser.add_argument('--port', default='55439')
parser.add_argument('--username', default='postgres')
parser.add_argument('--psql', default=shutil.which('psql') or '/Applications/Postgres.app/Contents/Versions/latest/bin/psql')
parser.add_argument('--without-provider-repair', action='store_true', help='Reproduce provider acceptance against the previous guards')
args = parser.parse_args()
tests = Path(__file__).resolve().parent
migration = (tests.parent / 'migrations/20261123021000_single_use_invitation_setup.sql').read_text()
migration = '\n'.join(line for line in migration.splitlines() if line.strip().lower() not in ('begin;', 'commit;'))
repair = (tests.parent / 'migrations/20261123030000_fix_reinvitation_signup.sql').read_text()
repair = '\n'.join(line for line in repair.splitlines() if line.strip().lower() not in ('begin;', 'commit;'))
protocol = (tests.parent / 'migrations/20261123040000_invitation_login_password_reset.sql').read_text()
protocol = '\n'.join(line for line in protocol.splitlines() if line.strip().lower() not in ('begin;', 'commit;'))
provider = '' if args.without_provider_repair else (tests.parent / 'migrations/20261123050000_fix_provider_invite_acceptance.sql').read_text()
provider = '\n'.join(line for line in provider.splitlines() if line.strip().lower() not in ('begin;', 'commit;'))
sql = (tests / 'invitation_setup.sql').read_text().replace('\\i :migration_file', migration).replace('\\i :repair_file', repair).replace('\\i :protocol_file', protocol).replace('\\i :provider_file', provider)
subprocess.run([args.psql, '--host', args.host, '--port', args.port, '--username', args.username,
                '--dbname', 'checkit_invitation_setup_test', '--no-psqlrc', '--set', 'ON_ERROR_STOP=on'],
               input=sql, text=True, check=True)
