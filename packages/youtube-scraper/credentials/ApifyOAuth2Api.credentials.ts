import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Apify OAuth2 credential, for n8n Cloud.
 *
 * Cloud users cannot comfortably paste a long-lived API token, so this offers
 * the "Connect my account" button instead. The flow is PKCE, which is designed
 * for clients that cannot keep a secret, so no client secret is needed here.
 *
 * `clientId` is deliberately left blank and hidden — exactly as Apify ships it
 * in their Actor node template and as every node generated from it publishes
 * it. n8n supplies the registered client for the `apifyOAuth2Api` credential
 * type centrally, so the name has to match Apify's for the button to work.
 *
 * Self-hosted users should keep using the API Key credential; it is the
 * default, and OAuth2 has to be picked explicitly.
 */
const scopes = ['profile', 'full_api_access'];

export class ApifyOAuth2Api implements ICredentialType {
	name = 'apifyOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Apify OAuth2 API';

	documentationUrl = 'https://docs.apify.com/platform/integrations/api#api-token';

	icon: Icon = {
		light: 'file:../nodes/YouTubeScraper/youTubeScraper.svg',
		dark: 'file:../nodes/YouTubeScraper/youTubeScraper.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'pkce',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://console.apify.com/authorize/oauth',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://console-backend.apify.com/oauth/apps/token',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: scopes.join(' '),
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'header',
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'hidden',
			default: '',
			typeOptions: { password: true },
		},
	];
}
