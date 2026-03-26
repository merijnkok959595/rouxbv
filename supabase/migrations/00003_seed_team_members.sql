-- Seed team_members from user_mapping-2.csv
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe to run multiple times (upserts on ghl_user_id within org)

-- Ensure columns exist
alter table public.team_members
  add column if not exists phone       text,
  add column if not exists calendar_id text;

do $$
declare
  org_id uuid;
  emp record;
begin
  select id into org_id from public.organizations limit 1;

  for emp in (
    select * from (values
      ('Sanne',              'F0UHpPHLihJgfG9QjevO', null,                   null,            'Medewerker',      'Heel Nederland',                       array['*']),
      ('Ronald Stavenuiter', 'LfuAg3aLnxMEHjTbOmSJ', 'vMyAj2aTgafYmfxjRphd', '+31653262771',  'Account Manager', 'Noord-Holland / Friesland',             array['1000-1199','1100-1119','1300-1399','1400-1889','1900-1999','2000-2099','3400-3499','7700-7999','8000-9299','8200-8299','9700-9999']),
      ('Dick Rol',           'VqOfGuqAey5sxIfo8Z8A', 'O2gP3ie5jb1vVp1b0Of2', '+31625150376',  'Account Manager', 'Zuid-Holland / Zeeland',                array['2100-2199','2200-3399','4000-4099','4100-4199','4200-4299','4300-4699']),
      ('Marscha Snoeken',    'GiPzqTrPqyIRP5fHNiHH', 'klhJ3tksjI8UE3rfwraH', '+31631000362',  'Account Manager', 'Overijssel / Groningen / Drenthe',       array['1200-1399','3500-3999','6500-7399','7400-7699','8000-8299','8300-8399','9300-9399','9400-9499','9500-9599','9600-9699']),
      ('Ralph Oenstra',      'WkNyqmsMyXemi46mKHwp', 'LJTS59YxojV82HZpnwfW', '+31611865464',  'Account Manager', 'Noord-Brabant / Limburg',                array['4700-5299','5300-5399','5400-5499','5500-5599','5600-5999','5800-6599']),
      ('Vincent Jongens',    'QniTAkf9ukC3aSlOJ0ja', 'sUWSaGULtR9HXqBLkTGr', '+31613853851',  'Eigenaar',        'Heel Nederland',                        array['*']),
      ('Merijn Kok',         'ShhTPAw4QYMM7N714xec', '0GtDEkz9uptiLv5WMutP', '+31627207989',  'Eigenaar',        'Heel Nederland',                        array['*']),
      ('Kim Groot',          'oqAcQRbcGuVn8jNv9Pp9', 'LOfyWVIdzLSIKwRBha97', '+31623342475',  'Eigenaar',        'Heel Nederland',                        array['*']),
      ('Isabelle Schuurman', 'DBhBVjYrtlcArG7DI81j', 'KH9GNd61fXCV6hz4MJMm', '+31630172557',  'Medewerker',      'Heel Nederland',                        array['*'])
    ) as t(naam, ghl_user_id, calendar_id, phone, functie, rayon, postcode_ranges)
  ) loop
    if exists (
      select 1 from public.team_members
      where organization_id = org_id and ghl_user_id = emp.ghl_user_id
    ) then
      update public.team_members set
        naam            = emp.naam,
        calendar_id     = emp.calendar_id,
        phone           = emp.phone,
        functie         = emp.functie,
        rayon           = emp.rayon,
        postcode_ranges = emp.postcode_ranges,
        active          = true
      where organization_id = org_id and ghl_user_id = emp.ghl_user_id;
    else
      insert into public.team_members
        (organization_id, naam, ghl_user_id, calendar_id, phone, functie, rayon, postcode_ranges, active)
      values
        (org_id, emp.naam, emp.ghl_user_id, emp.calendar_id, emp.phone, emp.functie, emp.rayon, emp.postcode_ranges, true);
    end if;
  end loop;
end $$;
