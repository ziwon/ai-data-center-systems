import { ogResponse, ogSiteTitle, renderOgCard } from '../lib/og-card';

export const prerender = true;

export async function GET() {
  const image = await renderOgCard({
    site: true,
    title: ogSiteTitle,
    description: 'Networking, inference, training, MLOps, storage, and performance engineering study notes.',
  });
  return ogResponse(image);
}
