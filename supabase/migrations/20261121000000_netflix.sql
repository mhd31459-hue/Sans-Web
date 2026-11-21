-- Allow Netflix titles.
alter table titles drop constraint if exists titles_service_check;
alter table titles add constraint titles_service_check check (service in ('prime','disney','netflix'));
