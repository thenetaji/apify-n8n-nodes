import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Apify API token credential.
 *
 * Users generate a personal API token from the Apify Console
 * (Settings -> Integrations) and paste it here. The token is sent as a
 * bearer token on every request this node package makes to the Apify API.
 *
 * Deliberately declared with the same `apifyApi` name and shape as the other
 * packages in this repo, so one saved Apify credential works across every
 * Actor node a user installs rather than one per package.
 */
export class ApifyApi implements ICredentialType {
	name = 'apifyApi';

	displayName = 'Apify API';

	documentationUrl = 'https://docs.apify.com/platform/integrations/api#api-token';

	icon: Icon = {
		light: 'file:../nodes/Pinterest/pinterest.svg',
		dark: 'file:../nodes/Pinterest/pinterest.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Apify personal API token, available under Settings > Integrations in the Apify Console',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.token}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.apify.com/v2',
			url: '/users/me',
			method: 'GET',
		},
	};
}
