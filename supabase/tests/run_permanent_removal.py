"""Run account-removal regressions in an existing, isolated local database.

Example: python3 supabase/tests/run_permanent_removal.py --host /tmp --port 55439
Create checkit_permanent_removal_test beforehand. Fixtures are rolled back.
"""
import argparse
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='/tmp')
    parser.add_argument('--port', default='55439')
    parser.add_argument('--username', default='postgres')
    parser.add_argument('--psql', default=shutil.which('psql') or '/Applications/Postgres.app/Contents/Versions/latest/bin/psql')
    args = parser.parse_args()
    tests = Path(__file__).resolve().parent
    migrations = tests.parent / 'migrations'

    def without_transaction(path):
        return '\n'.join(line for line in path.read_text().splitlines()
                         if line.strip().lower() not in ('begin;', 'commit;'))

    workflow = next(migrations.glob('*insights_report_workflow.sql'))
    sql = (tests / 'permanent_team_account_removal.sql').read_text()
    sql = sql.replace('\\i :workflow_file', without_transaction(workflow))
    sql = sql.replace('\\i :migration_file', without_transaction(migrations / '20261123010000_permanent_team_account_removal.sql'))
    sql = sql.replace('\\i :retirement_file', without_transaction(migrations / '20261123010100_retire_membership_only_removal.sql'))
    subprocess.run([args.psql, '--host', args.host, '--port', args.port,
                    '--username', args.username, '--dbname', 'checkit_permanent_removal_test',
                    '--no-psqlrc', '--set', 'ON_ERROR_STOP=on'], input=sql, text=True, check=True)


if __name__ == '__main__':
    main()
