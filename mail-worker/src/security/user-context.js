import JwtUtils from '../utils/jwt-utils';
import { getAuthToken } from './auth-session';

const userContext = {
	getUserId(c) {
		return c.get('user').userId;
	},

	getUser(c) {
		return c.get('user');
	},

	async getToken(c) {
		const jwt = c.get?.('authToken') || getAuthToken(c).token;
		const result = await JwtUtils.verifyToken(c, jwt);
		return result?.token;
	},
};
export default userContext;
