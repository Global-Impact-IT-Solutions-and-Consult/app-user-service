import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class DeleteCompanyDto {
  @ApiProperty({
    description: 'Must match the company name exactly to confirm deletion',
    example: 'Acme Corporation',
  })
  @IsString()
  confirmation: string;
}
