
INSERT INTO storage.buckets (id, name, public) VALUES ('team-logos', 'team-logos', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('player-photos', 'player-photos', true) ON CONFLICT DO NOTHING;

CREATE POLICY "Team logos public read" ON storage.objects FOR SELECT USING (bucket_id = 'team-logos');
CREATE POLICY "Team logos admin write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'team-logos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Team logos admin update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'team-logos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Team logos admin delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'team-logos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Player photos public read" ON storage.objects FOR SELECT USING (bucket_id = 'player-photos');
CREATE POLICY "Player photos admin write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'player-photos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Player photos admin update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'player-photos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Player photos admin delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'player-photos' AND public.has_role(auth.uid(), 'admin'));
