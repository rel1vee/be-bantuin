import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { getBatch, getNIM } from '../../utils/getValue';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private configService: ConfigService) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID')!,
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET')!,
      callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const { id, name, emails, photos } = profile;

    const email = emails?.[0]?.value;
    const picture = photos?.[0]?.value;
    const givenName = name?.givenName;
    const familyName = name?.familyName;

    if (!email) {
      return done(new Error('No email found in Google profile'));
    }

    const nim = getNIM(email);
    const batch = getBatch(email);

    const user = {
      googleId: id,
      email: email,
      fullName: givenName || 'Unnamed User',
      nim: nim,
      batch: batch,
      major: familyName || null, // Sesuai skema, `major` bisa null
      picture: picture, // Changed from profilePicture to match DTO
      provider: 'google',
    };

    done(null, user);
  }
}
